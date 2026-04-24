import http from "http";
import type { PgJobStore } from "./pgJobStore.js";
import type { RedisJobQueue, InMemoryFallbackQueue } from "./redisQueue.js";
import { validateInput } from "./validation.js";
import { withObservability } from "../../shared/observability.js";

type AnyStore = PgJobStore;
type AnyQueue = RedisJobQueue | InMemoryFallbackQueue;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
}

export function createServer(store: AnyStore, queue: AnyQueue): http.Server {
  return http.createServer(async (req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    if (method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
      res.end(); return;
    }

    // POST /jobs
    if (method === "POST" && url === "/jobs") {
      let body: unknown;
      try {
        const raw = await readBody(req);
        body = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: "Invalid JSON body." });
      }

      const validation = validateInput(body);
      if (!validation.valid || !validation.parsed) {
        return send(res, 400, { error: validation.error });
      }

      try {
        const { pipeline_type, input_text, input_json } = validation.parsed;
        const job = await withObservability(
          { project: "ai-automation-system", endpoint: "/jobs" },
          () => store.createJob(pipeline_type, input_text, input_json)
        );
        await queue.enqueue(job.job_id);
        return send(res, 202, { job_id: job.job_id });
      } catch (err) {
        return send(res, 500, { error: (err as Error).message });
      }
    }

    // GET /jobs/:job_id
    const jobMatch = url.match(/^\/jobs\/([^/]+)$/);
    if (method === "GET" && jobMatch) {
      try {
        const job = await store.getJob(jobMatch[1]);
        if (!job) return send(res, 404, { error: `Job "${jobMatch[1]}" not found.` });
        const response: Record<string, unknown> = { job_id: job.job_id, status: job.status };
        if (job.result !== undefined) response["result"] = job.result;
        if (job.error !== undefined) response["error"] = job.error;
        return send(res, 200, response);
      } catch (err) {
        // Handle invalid UUID format or other DB errors as 404
        const msg = (err as Error).message ?? "";
        if (msg.includes("invalid input syntax") || msg.includes("uuid")) {
          return send(res, 404, { error: `Job "${jobMatch[1]}" not found.` });
        }
        return send(res, 500, { error: msg });
      }
    }

    // GET /jobs (list recent)
    if (method === "GET" && url === "/jobs") {
      try {
        const jobs = await store.getRecentJobs(20);
        return send(res, 200, jobs);
      } catch (err) {
        return send(res, 500, { error: (err as Error).message });
      }
    }

    // GET /status
    if (method === "GET" && url === "/status") {
      return send(res, 200, { status: "ok", model: "llama-3.3-70b-versatile", queue: "Redis" });
    }

    // GET /health
    if (method === "GET" && url === "/health") {
      return send(res, 200, { status: "healthy", service: "ai-automation-system", timestamp: new Date().toISOString() });
    }

    // GET /telemetry — returns recent job telemetry for the AI Control Center collector
    if (method === "GET" && url === "/telemetry") {
      try {
        const jobs = await store.getRecentJobs(50);
        const records = jobs.map(j => ({
          queryId: j.job_id,
          timestamp: j.created_at,
          latencyMs: 0, // jobs are async; latency not tracked per-job
          success: j.status === "completed",
          modelId: "llama-3.3-70b-versatile",
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          pipelineType: j.pipeline_type,
          status: j.status,
        }));
        return send(res, 200, records);
      } catch (err) {
        return send(res, 500, { error: (err as Error).message });
      }
    }

    return send(res, 404, { error: "Not found." });
  });
}
