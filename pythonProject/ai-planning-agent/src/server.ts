/**
 * AI Planning Agent — HTTP server
 * POST /run   { task: string }  → AgentResult
 * GET  /runs  → recent agent runs from DB
 * GET  /status
 */

import http from "http";
import { getDbAsync } from "../../shared/db.js";
import { withObservability } from "../../shared/observability.js";
import { securityCheck } from "../../shared/security.js";
import { selectModel } from "../../shared/llmops.js";
import type { AgentResult } from "./types.js";

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
}

async function persistRun(task: string, result: AgentResult, latencyMs: number, model: string): Promise<void> {
  try {
    const db = await getDbAsync();
    await db.query(
      `INSERT INTO agent_runs (task, success, steps, summary, error, latency_ms, model_used)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [task, result.success, JSON.stringify(result.logs), result.summary ?? null, result.error ?? null, latencyMs, model]
    );
  } catch (e) {
    console.error("[agent] Failed to persist run:", e);
  }
}

export function createAgentServer(runAgent: (task: string, model: string) => Promise<AgentResult>) {
  return http.createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";

    if (method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
      res.end(); return;
    }

    // POST /run
    if (method === "POST" && url === "/run") {
      let body: string;
      try { body = await readBody(req); } catch { send(res, 400, { error: "Failed to read body" }); return; }

      let parsed: { task: string; complexity?: "low" | "medium" | "high" };
      try { parsed = JSON.parse(body); } catch { send(res, 400, { error: "Invalid JSON" }); return; }
      if (!parsed.task?.trim()) { send(res, 400, { error: "Missing task" }); return; }

      // Security check
      const security = await securityCheck(parsed.task, "anonymous", "ai-planning-agent", "user", "chat");
      if (!security.passed) { send(res, security.statusCode ?? 400, { error: security.reason }); return; }

      // Cost-aware model selection
      const model = selectModel(parsed.complexity ?? "medium");

      const start = Date.now();
      try {
        const result = await withObservability(
          { project: "ai-planning-agent", endpoint: "/run", model },
          () => runAgent(parsed.task, model)
        );
        const latencyMs = Date.now() - start;
        persistRun(parsed.task, result, latencyMs, model).catch(() => {});
        send(res, 200, { ...result, model, latencyMs });
      } catch (err) {
        send(res, 500, { error: (err as Error).message });
      }
      return;
    }

    // GET /runs
    if (method === "GET" && url.startsWith("/runs")) {
      try {
        const db = await getDbAsync();
        const rows = await db.query(
          `SELECT id, task, success, summary, error, latency_ms, model_used, created_at
           FROM agent_runs ORDER BY created_at DESC LIMIT 20`
        );
        send(res, 200, rows.rows);
      } catch (err) {
        send(res, 500, { error: (err as Error).message });
      }
      return;
    }

    // GET /status
    if (method === "GET" && url === "/status") {
      send(res, 200, { status: "ok", model: "llama-3.3-70b-versatile (cost-aware routing)" });
      return;
    }

    // GET /health
    if (method === "GET" && url === "/health") {
      send(res, 200, { status: "healthy", service: "ai-planning-agent", timestamp: new Date().toISOString() });
      return;
    }

    // GET /telemetry — returns recent agent run telemetry for the AI Control Center collector
    if (method === "GET" && url === "/telemetry") {
      try {
        const db = await getDbAsync();
        const rows = await db.query(
          `SELECT id, task, success, latency_ms, model_used, created_at
           FROM agent_runs ORDER BY created_at DESC LIMIT 50`
        );
        const records = rows.rows.map((r: Record<string, unknown>) => ({
          queryId: r.id as string,
          timestamp: (r.created_at as Date).toISOString(),
          latencyMs: (r.latency_ms as number) ?? 0,
          success: r.success as boolean,
          modelId: (r.model_used as string) ?? "llama-3.3-70b-versatile",
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
        }));
        send(res, 200, records);
      } catch (err) {
        send(res, 500, { error: (err as Error).message });
      }
      return;
    }

    send(res, 404, { error: "Endpoints: POST /run, GET /runs, GET /status" });
  });
}
