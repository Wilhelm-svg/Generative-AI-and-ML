/**
 * REST API server — production-grade Node http server
 * Uses PostgreSQL for persistence when DATABASE_URL is set
 */

import http from "http";
import { randomUUID } from "crypto";
import { validateRecord, predict, explain, recommend, REQUIRED_FIELDS } from "./engine";
import { InMemoryPredictionStore } from "./store";
import { PgPredictionStore } from "./pgStore";
import { generateInsights } from "./insights";
import { withObservability } from "../../shared/observability";
import type { InputRecord, StoredPrediction } from "./types";

type AnyStore = InMemoryPredictionStore | PgPredictionStore;

function createStore(): AnyStore {
  if (process.env.DATABASE_URL) {
    console.log("[store] Using PostgreSQL prediction store");
    return new PgPredictionStore();
  }
  console.warn("[store] DATABASE_URL not set — using in-memory store");
  return new InMemoryPredictionStore();
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

export function createServer(store: AnyStore = createStore()): http.Server {
  return http.createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;

    if (method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
      res.end(); return;
    }

    // POST /predict
    if (method === "POST" && pathname === "/predict") {
      let body: unknown;
      try { body = await readBody(req); }
      catch { sendJson(res, 400, { error: "Invalid JSON body" }); return; }

      const raw = body as Record<string, unknown>;
      // Always generate a fresh UUID — ignore any client-provided id to avoid DB type errors
      raw.id = randomUUID();

      const validationError = validateRecord(body, REQUIRED_FIELDS);
      if (validationError) { sendJson(res, 400, validationError); return; }

      try {
        const record = body as InputRecord;
        const { label, confidence } = predict(record);
        const explanation = explain(record, label);
        const recommendation = recommend(label, explanation, record.fields);

        const stored: StoredPrediction = {
          id: record.id,
          timestamp: new Date().toISOString(),
          input: record.fields as Record<string, unknown>,
          label, confidence, explanation, recommendation,
        };

        await withObservability(
          { project: "ai-decision-system", endpoint: "/predict" },
          () => store.add(stored)
        );
        sendJson(res, 200, { id: stored.id, label, confidence, explanation, recommendation });
      } catch (err) {
        console.error("Inference error:", err);
        sendJson(res, 500, { error: "Model inference failed" });
      }
      return;
    }

    // GET /predictions/:id
    const idMatch = pathname.match(/^\/predictions\/(.+)$/);
    if (method === "GET" && idMatch) {
      try {
        const prediction = await store.getById(idMatch[1]);
        if (!prediction) { sendJson(res, 404, { error: "Not found" }); return; }
        sendJson(res, 200, prediction); return;
      } catch {
        sendJson(res, 404, { error: "Not found" }); return;
      }
    }

    // GET /predictions
    if (method === "GET" && pathname === "/predictions") {
      const labelFilter = url.searchParams.get("label");
      const results = labelFilter ? await store.getByLabel(labelFilter) : await store.getAll();
      sendJson(res, 200, results); return;
    }

    // GET /insights
    if (method === "GET" && pathname === "/insights") {
      const all = await store.getAll();
      const insights = generateInsights(all);
      if (insights.length === 0) {
        sendJson(res, 200, { insights: [], message: "Submit at least 10 records to generate insights." });
      } else {
        sendJson(res, 200, { insights });
      }
      return;
    }

    // GET /health
    if (method === "GET" && pathname === "/health") {
      sendJson(res, 200, { status: "healthy", service: "ai-decision-system", timestamp: new Date().toISOString() });
      return;
    }

    // GET /telemetry — returns recent prediction telemetry for the AI Control Center collector
    if (method === "GET" && pathname === "/telemetry") {
      try {
        const all = await store.getAll();
        const records = all.slice(0, 50).map(p => ({
          queryId: p.id,
          timestamp: p.timestamp,
          latencyMs: 0,
          success: true,
          modelId: "stacked-ensemble-xgb-lgbm-rf",
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          label: p.label,
          confidence: p.confidence,
        }));
        sendJson(res, 200, records);
      } catch (err) {
        sendJson(res, 500, { error: (err as Error).message });
      }
      return;
    }

    // GET / — API info
    if (method === "GET" && pathname === "/") {
      sendJson(res, 200, { 
        service: "ai-decision-system",
        version: "1.0.0",
        endpoints: [
          "POST /predict",
          "GET /predictions",
          "GET /predictions/:id",
          "GET /insights",
          "GET /health",
          "GET /telemetry"
        ]
      });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  });
}

// Entry point
if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`AI Decision System API listening on http://localhost:${PORT}`);
    console.log("Endpoints: POST /predict | GET /predictions | GET /predictions/:id | GET /insights");
  });
}
