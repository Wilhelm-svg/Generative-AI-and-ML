/**
 * LLMOps — Prompt versioning, experiment tracking, cost-aware model routing
 */

import { getDbAsync } from "./db.js";

// ── Prompt Versioning ─────────────────────────────────────────────────────

export async function savePromptVersion(
  project: string,
  name: string,
  content: string,
  model: string
): Promise<number> {
  const db = await getDbAsync();
  // Deactivate previous versions
  await db.query(
    `UPDATE prompt_versions SET is_active = FALSE WHERE project = $1 AND name = $2`,
    [project, name]
  );
  // Get next version number
  const versionResult = await db.query(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM prompt_versions WHERE project = $1 AND name = $2`,
    [project, name]
  );
  const version = versionResult.rows[0].next_version as number;
  await db.query(
    `INSERT INTO prompt_versions (project, name, version, content, model, is_active) VALUES ($1,$2,$3,$4,$5,TRUE)`,
    [project, name, version, content, model]
  );
  return version;
}

export async function getActivePrompt(project: string, name: string): Promise<{ content: string; model: string; version: number } | null> {
  const db = await getDbAsync();
  const result = await db.query(
    `SELECT content, model, version FROM prompt_versions WHERE project = $1 AND name = $2 AND is_active = TRUE LIMIT 1`,
    [project, name]
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    content: row.content as string,
    model: row.model as string,
    version: row.version as number,
  };
}
// ── Cost-Aware Model Routing ──────────────────────────────────────────────

export type ModelTier = "fast" | "balanced" | "powerful";

const MODEL_TIERS: Record<ModelTier, string> = {
  fast:      "llama-3.1-8b-instant",      // ~$0.05/1M tokens — for eval, simple tasks
  balanced:  "llama-3.3-70b-versatile",   // ~$0.59/1M tokens — default
  powerful:  "llama-3.3-70b-versatile",   // same for now; swap to GPT-4 if needed
};

export function selectModel(
  taskComplexity: "low" | "medium" | "high",
  budgetConstraint: "tight" | "normal" | "unlimited" = "normal"
): string {
  if (budgetConstraint === "tight" || taskComplexity === "low") {
    return MODEL_TIERS.fast;
  }
  if (taskComplexity === "high" && budgetConstraint === "unlimited") {
    return MODEL_TIERS.powerful;
  }
  return MODEL_TIERS.balanced;
}

// ── Retry with Exponential Backoff ────────────────────────────────────────

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; baseDelayMs?: number; label?: string } = {}
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 500, label = "operation" } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt === maxAttempts;
      const isRateLimit = (err as { status?: number }).status === 429;

      if (isLast) {
        console.error(`[retry] ${label} failed after ${maxAttempts} attempts:`, (err as Error).message);
        throw err;
      }

      const delay = isRateLimit
        ? baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000
        : baseDelayMs * Math.pow(2, attempt - 1);

      console.warn(`[retry] ${label} attempt ${attempt} failed, retrying in ${Math.round(delay)}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error("Unreachable");
}

// ── Circuit Breaker ───────────────────────────────────────────────────────

interface CircuitState {
  failures: number;
  lastFailure: number;
  state: "closed" | "open" | "half-open";
}

const circuits = new Map<string, CircuitState>();

export function circuitBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  options: { failureThreshold?: number; resetTimeoutMs?: number } = {}
): Promise<T> {
  const { failureThreshold = 5, resetTimeoutMs = 30_000 } = options;
  const circuit = circuits.get(name) ?? { failures: 0, lastFailure: 0, state: "closed" as const };

  if (circuit.state === "open") {
    if (Date.now() - circuit.lastFailure > resetTimeoutMs) {
      circuit.state = "half-open";
    } else {
      return Promise.reject(new Error(`Circuit breaker '${name}' is OPEN — service unavailable`));
    }
  }

  return fn().then(
    (result) => {
      if (circuit.state === "half-open") {
        circuit.state = "closed";
        circuit.failures = 0;
      }
      circuits.set(name, circuit);
      return result;
    },
    (err) => {
      circuit.failures++;
      circuit.lastFailure = Date.now();
      if (circuit.failures >= failureThreshold) {
        circuit.state = "open";
        console.error(`[circuit-breaker] '${name}' OPENED after ${circuit.failures} failures`);
      }
      circuits.set(name, circuit);
      throw err;
    }
  );
}
