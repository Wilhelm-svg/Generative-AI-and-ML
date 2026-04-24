import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { authMiddleware, generateToken } from "./auth.js";
import { handleRequest, type OrchestratorDeps } from "./orchestrator.js";
import { ingestToDB } from "./vectordb.js";
import { securityCheck } from "../../shared/security.js";
import { withObservability, getStats } from "../../shared/observability.js";
import { evaluateRAG, saveEvalResult, getEvalSummary } from "../../shared/evaluation.js";
import type { CopilotRequest } from "./types.js";

const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function sendJSON(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Role",
  });
  res.end(JSON.stringify(body));
}

export function createCopilotServer(deps: OrchestratorDeps) {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";

    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Role",
      });
      res.end();
      return;
    }

    // ── POST /token (dev helper — generate a signed token) ──────────────────
    if (method === "POST" && url === "/token") {
      let body: string;
      try { body = await readBody(req); } catch { sendJSON(res, 400, { error: "Failed to read body" }); return; }
      let parsed: { userId?: string; role?: string };
      try { parsed = JSON.parse(body); } catch { sendJSON(res, 400, { error: "Invalid JSON" }); return; }
      if (!parsed.userId) { sendJSON(res, 400, { error: "Missing userId" }); return; }
      const token = generateToken({
        userId: parsed.userId,
        role: (parsed.role as "admin" | "user" | "readonly") ?? "user",
        allowedTools: ["send_email", "write_db_record"],
      });
      sendJSON(res, 200, { token });
      return;
    }

    // ── POST /chat ──────────────────────────────────────────────────────────
    if (method === "POST" && url === "/chat") {
      let body: string;
      try { body = await readBody(req); } catch { sendJSON(res, 400, { error: "Failed to read body" }); return; }

      let copilotReq: CopilotRequest;
      try {
        copilotReq = JSON.parse(body) as CopilotRequest;
        if (!copilotReq.message) { sendJSON(res, 400, { error: "Missing message" }); return; }
      } catch { sendJSON(res, 400, { error: "Invalid JSON" }); return; }

      // Extract token from Authorization header (Bearer token) or request body
      const authHeader = req.headers.authorization;
      let token: string | undefined;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7);
      } else {
        token = copilotReq.sessionToken;
      }

      // Auth — validate token and extract payload
      let tokenPayload;
      try {
        tokenPayload = authMiddleware({ ...copilotReq, sessionToken: token ?? "" });
      } catch (err) {
        sendJSON(res, (err as { status?: number }).status ?? 401, { error: (err as Error).message });
        return;
      }

      // Use userId from token (not from request body — prevents spoofing)
      copilotReq = { ...copilotReq, userId: tokenPayload.userId };

      // Security check
      const role = tokenPayload.role;
      const security = await securityCheck(copilotReq.message, tokenPayload.userId, "enterprise-ai-copilot", role, "chat");
      if (!security.passed) { sendJSON(res, security.statusCode ?? 400, { error: security.reason }); return; }

      try {
        const response = await withObservability(
          { project: "enterprise-ai-copilot", endpoint: "/chat", userId: tokenPayload.userId },
          () => handleRequest(copilotReq, deps, tokenPayload)
        );

        // Async RAG evaluation — pass actual chunk text as context, not just filenames
        if (response.citations?.length && response.answer && GROQ_API_KEY) {
          // Re-retrieve the chunks to get actual text for evaluation
          import("./vectordb.js").then(({ hybridRetrieve }) =>
            hybridRetrieve(copilotReq.message, tokenPayload.userId, deps.embedFn, 3)
              .then(chunks => {
                const context = chunks.map(c => c.text).join("\n\n").slice(0, 2000);
                return evaluateRAG(copilotReq.message, response.answer, context, GROQ_API_KEY);
              })
              .then(evalResult =>
                saveEvalResult("enterprise-ai-copilot", "rag", copilotReq.message, response.answer, evalResult)
              )
              .catch(e => console.error("[eval] async eval failed:", e))
          ).catch(e => console.error("[eval] import failed:", e));
        }

        sendJSON(res, 200, response);
      } catch (err) {
        sendJSON(res, 500, { error: (err as Error).message });
      }
      return;
    }

    // ── POST /ingest ────────────────────────────────────────────────────────
    if (method === "POST" && url === "/ingest") {
      let body: string;
      try { body = await readBody(req); } catch { sendJSON(res, 400, { error: "Failed to read body" }); return; }

      let parsed: { text: string; fileName?: string; permissions?: string[]; chunkStrategy?: "fixed" | "sentence" | "paragraph" };
      try { parsed = JSON.parse(body); } catch { sendJSON(res, 400, { error: "Invalid JSON" }); return; }
      if (!parsed.text) { sendJSON(res, 400, { error: "Missing text field" }); return; }

      // Extract token from Authorization header (Bearer token)
      const authHeader = req.headers.authorization;
      let token: string | undefined;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7);
      }

      // Auth — validate token and extract userId
      let tokenPayload;
      try {
        const { authMiddleware } = await import("./auth.js");
        tokenPayload = authMiddleware({ message: "", sessionToken: token ?? "", userId: "" });
      } catch (err) {
        sendJSON(res, (err as { status?: number }).status ?? 401, { error: (err as Error).message });
        return;
      }

      try {
        const result = await ingestToDB(
          {
            fileBuffer: Buffer.from(parsed.text, "utf-8"),
            fileName: parsed.fileName ?? "document.txt",
            // Use userId from token for permissions, plus any additional permissions
            permissions: parsed.permissions ?? [tokenPayload.userId, "default"],
          },
          deps.embedFn,
          { strategy: parsed.chunkStrategy ?? "fixed", chunkSize: 512, overlap: 64 }
        );
        sendJSON(res, 200, { message: "Ingested successfully", ...result });
      } catch (err) {
        sendJSON(res, 500, { error: (err as Error).message });
      }
      return;
    }

    // ── GET /status ─────────────────────────────────────────────────────────
    if (method === "GET" && url === "/status") {
      const [stats, evalSummary] = await Promise.all([
        getStats("enterprise-ai-copilot").catch(() => null),
        getEvalSummary("enterprise-ai-copilot").catch(() => null),
      ]);
      sendJSON(res, 200, { status: "ok", service: "enterprise-ai-copilot", model: "llama-3.3-70b-versatile", observability: stats, evaluation: evalSummary });
      return;
    }

    // ── GET /health ─────────────────────────────────────────────────────────
    if (method === "GET" && url === "/health") {
      sendJSON(res, 200, { status: "healthy", service: "enterprise-ai-copilot", timestamp: new Date().toISOString() });
      return;
    }

    // ── GET /telemetry ───────────────────────────────────────────────────────
    // Returns recent request telemetry for the AI Control Center collector
    if (method === "GET" && url === "/telemetry") {
      try {
        const { getDbAsync } = await import("../../shared/db.js");
        const db = await getDbAsync();
        const result = await db.query(
          `SELECT id, endpoint, latency_ms, tokens_in, tokens_out, cost_usd, status, created_at
           FROM request_logs WHERE project = 'enterprise-ai-copilot'
           ORDER BY created_at DESC LIMIT 50`
        );
        const records = result.rows.map((r: Record<string, unknown>) => ({
          queryId: r.id as string,
          timestamp: (r.created_at as Date).toISOString(),
          latencyMs: (r.latency_ms as number) ?? 0,
          success: r.status === "success",
          modelId: "llama-3.3-70b-versatile",
          tokensIn: (r.tokens_in as number) ?? 0,
          tokensOut: (r.tokens_out as number) ?? 0,
          costUsd: parseFloat(String(r.cost_usd ?? "0")),
        }));
        sendJSON(res, 200, records);
      } catch (err) {
        sendJSON(res, 500, { error: (err as Error).message });
      }
      return;
    }

    // ── GET /eval ───────────────────────────────────────────────────────────
    if (method === "GET" && url === "/eval") {
      const summary = await getEvalSummary("enterprise-ai-copilot").catch(() => null);
      sendJSON(res, 200, { project: "enterprise-ai-copilot", evaluation: summary });
      return;
    }

    sendJSON(res, 404, { error: "Not found. Endpoints: POST /chat, POST /ingest, POST /token, GET /status, GET /eval" });
  });
}
