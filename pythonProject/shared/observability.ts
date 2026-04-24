/**
 * Shared Observability — tracks latency, tokens, cost, failures across all projects
 * Writes to PostgreSQL request_logs table
 */

import { getDbAsync } from "./db.js";

// Groq pricing (per 1M tokens, as of 2025)
const COST_PER_1M: Record<string, { input: number; output: number }> = {
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "llama-3.1-8b-instant":    { input: 0.05, output: 0.08 },
  "mixtral-8x7b-32768":      { input: 0.24, output: 0.24 },
};

export interface RequestMetrics {
  project: string;
  endpoint: string;
  userId?: string;
  latencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
  model?: string;
  status: "success" | "error";
  errorMsg?: string;
}

export async function logRequest(metrics: RequestMetrics): Promise<void> {
  const cost = computeCost(metrics.model, metrics.tokensIn, metrics.tokensOut);
  try {
    const db = await getDbAsync();
    await db.query(
      `INSERT INTO request_logs (project, endpoint, user_id, latency_ms, tokens_in, tokens_out, cost_usd, status, error_msg)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        metrics.project, metrics.endpoint, metrics.userId ?? null,
        metrics.latencyMs, metrics.tokensIn ?? 0, metrics.tokensOut ?? 0,
        cost, metrics.status, metrics.errorMsg ?? null,
      ]
    );
  } catch (e) {
    // Never let observability break the main flow
    console.error("[observability] Failed to log request:", e);
  }
}

export function computeCost(model?: string, tokensIn = 0, tokensOut = 0): number {
  if (!model) return 0;
  const pricing = COST_PER_1M[model];
  if (!pricing) return 0;
  return (tokensIn / 1_000_000) * pricing.input + (tokensOut / 1_000_000) * pricing.output;
}

/** Wrap an async function with automatic observability logging */
export async function withObservability<T>(
  metrics: Omit<RequestMetrics, "latencyMs" | "status" | "errorMsg">,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    await logRequest({ ...metrics, latencyMs: Date.now() - start, status: "success" });
    return result;
  } catch (err) {
    await logRequest({
      ...metrics,
      latencyMs: Date.now() - start,
      status: "error",
      errorMsg: (err as Error).message,
    });
    throw err;
  }
}

/** Get dashboard stats for a project */
export async function getStats(project: string, hours = 24) {
  const db = await getDbAsync();
  const result = await db.query(
    `SELECT
       COUNT(*)::int                                    AS total_requests,
       AVG(latency_ms)::int                            AS avg_latency_ms,
       PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::int AS p95_latency_ms,
       SUM(tokens_in + tokens_out)::int                AS total_tokens,
       SUM(cost_usd)::numeric(10,6)                    AS total_cost_usd,
       COUNT(*) FILTER (WHERE status = 'error')::int   AS error_count,
       ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'error') / NULLIF(COUNT(*),0), 2) AS error_rate_pct
     FROM request_logs
     WHERE project = $1 AND created_at > NOW() - INTERVAL '1 hour' * $2`,
    [project, hours]
  );
  return result.rows[0];
}
