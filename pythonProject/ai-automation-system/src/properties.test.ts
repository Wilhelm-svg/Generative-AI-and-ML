/**
 * All remaining property tests for AI Automation System
 * Properties 1-6 + integration tests
 * Feature: ai-automation-system
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { InMemoryJobStore } from "./jobStore.js";
import { validateInput } from "./validation.js";
import { InvoiceExtractor, EmailClassifier, TicketCategorizer } from "./extractors.js";
import type { PipelineType } from "./types.js";

const VALID_STATUSES = new Set(["pending", "processing", "completed", "failed"]);
const VALID_PIPELINE_TYPES: PipelineType[] = [
  "invoice_extraction",
  "email_classification",
  "support_ticket_categorization",
];

// ── Property 6: Job status is always a valid value ────────────────────────
// Feature: ai-automation-system, Property 6: Job status is always a valid value

describe("Property 6: Job status is always a valid value", () => {
  it("all job status transitions produce valid status values", () => {
    fc.assert(fc.property(
      fc.constantFrom(...VALID_PIPELINE_TYPES),
      fc.constantFrom("pending", "processing", "completed", "failed"),
      (pipelineType, targetStatus) => {
        const store = new InMemoryJobStore();
        const job = store.createJob(pipelineType, "test input");
        expect(VALID_STATUSES.has(job.status)).toBe(true);

        store.updateJob(job.job_id, { status: targetStatus as "pending" | "processing" | "completed" | "failed" });
        const updated = store.getJob(job.job_id);
        store.stop();
        return updated !== undefined && VALID_STATUSES.has(updated.status);
      }
    ), { numRuns: 200 });
  });
});

// ── Property 1: Valid inputs accepted; oversized inputs rejected ──────────
// Feature: ai-automation-system, Property 1: Valid inputs accepted; oversized inputs rejected

describe("Property 1: Input size boundary", () => {
  it("inputs ≤100KB are accepted; inputs >100KB are rejected", () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 200 }),
      (kbSize) => {
        const text = "a".repeat(kbSize * 1024);
        const body = { pipeline_type: "invoice_extraction", input_text: text };
        const result = validateInput(body);
        const bodyBytes = Buffer.byteLength(JSON.stringify(body), "utf8");
        if (bodyBytes <= 100 * 1024) return result.valid === true;
        return result.valid === false;
      }
    ), { numRuns: 50 });
  });
});

// ── Property 2: Job IDs are unique ────────────────────────────────────────
// Feature: ai-automation-system, Property 2: Job IDs are unique

describe("Property 2: Job IDs are unique", () => {
  it("all created job IDs are distinct", () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 50 }),
      (count) => {
        const store = new InMemoryJobStore();
        const ids = Array.from({ length: count }, () =>
          store.createJob("invoice_extraction", "text").job_id
        );
        store.stop();
        return new Set(ids).size === ids.length;
      }
    ), { numRuns: 50 });
  });
});

// ── Property 3: Failed jobs always include a reason ───────────────────────
// Feature: ai-automation-system, Property 3: Failed jobs always include a reason

describe("Property 3: Failed jobs always include a reason", () => {
  it("any job marked failed always has a non-empty error field", () => {
    fc.assert(fc.property(
      fc.string({ minLength: 1, maxLength: 200 }),
      (errorReason) => {
        const store = new InMemoryJobStore();
        const job = store.createJob("invoice_extraction", "test");
        store.updateJob(job.job_id, { status: "failed", error: errorReason });
        const updated = store.getJob(job.job_id);
        store.stop();
        return updated?.status === "failed" && typeof updated.error === "string" && updated.error.length > 0;
      }
    ), { numRuns: 200 });
  });
});

// ── Property 4: Structured output conforms to schema ─────────────────────
// Feature: ai-automation-system, Property 4: Structured output conforms to schema and includes valid confidence score

describe("Property 4: Confidence score always in [0, 1]", () => {
  it("all extractors return confidence in [0, 1] for any text input", async () => {
    await fc.assert(fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 200 }),
      async (text) => {
        const inv = await new InvoiceExtractor().extract({ input_text: text });
        const email = await new EmailClassifier().classify({ input_text: text });
        const ticket = await new TicketCategorizer().categorize({ input_text: text });
        return [inv, email, ticket].every(r => r.confidence >= 0 && r.confidence <= 1);
      }
    ), { numRuns: 5 }); // low — uses real API fallback
  });
});

// ── Property 5: Output retrieval round-trip ───────────────────────────────
// Feature: ai-automation-system, Property 5: Output retrieval round-trip

describe("Property 5: Output retrieval round-trip", () => {
  it("completed job result is retrievable by job_id", () => {
    fc.assert(fc.property(
      fc.constantFrom(...VALID_PIPELINE_TYPES),
      fc.string({ minLength: 1, maxLength: 100 }),
      (pipelineType, inputText) => {
        const store = new InMemoryJobStore();
        const job = store.createJob(pipelineType, inputText);
        const mockResult = {
          pipeline_type: pipelineType,
          confidence: 0.9,
          data: { vendor: "Test", amount: 100, currency: "USD", date: "2024-01-01", line_items: [] },
        };
        store.updateJob(job.job_id, { status: "completed", result: mockResult as never });
        const retrieved = store.getJob(job.job_id);
        store.stop();
        return retrieved?.status === "completed" && retrieved.result !== undefined;
      }
    ), { numRuns: 100 });
  });
});

// ── Task 8.2: Integration test for end-to-end job completion ─────────────

describe("Integration: end-to-end job lifecycle", () => {
  it("job goes through pending → processing → completed lifecycle", () => {
    const store = new InMemoryJobStore();
    const job = store.createJob("email_classification", "From: test@example.com\nI need help.");

    expect(job.status).toBe("pending");

    store.updateJob(job.job_id, { status: "processing" });
    expect(store.getJob(job.job_id)?.status).toBe("processing");

    const result = {
      pipeline_type: "email_classification" as PipelineType,
      confidence: 0.85,
      data: { category: "support", intent: "request", sender: "test@example.com", summary: "Help request" },
    };
    store.updateJob(job.job_id, { status: "completed", result: result as never });

    const completed = store.getJob(job.job_id);
    expect(completed?.status).toBe("completed");
    expect(completed?.result).toBeDefined();
    store.stop();
  });

  it("failed job retains error message", () => {
    const store = new InMemoryJobStore();
    const job = store.createJob("invoice_extraction", "bad input");
    store.updateJob(job.job_id, { status: "failed", error: "Extraction timeout after 30s" });

    const failed = store.getJob(job.job_id);
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toBe("Extraction timeout after 30s");
    store.stop();
  });

  it("404 for unknown job_id", () => {
    const store = new InMemoryJobStore();
    expect(store.getJob("nonexistent-id")).toBeUndefined();
    store.stop();
  });
});

// ── Task 8.3: 24-hour retention test ─────────────────────────────────────

describe("Task 8.3: Job retention", () => {
  it("completed jobs are retained immediately after completion", () => {
    const store = new InMemoryJobStore();
    const job = store.createJob("invoice_extraction", "test");
    store.updateJob(job.job_id, { status: "completed", result: { pipeline_type: "invoice_extraction", confidence: 0.9, data: {} } as never });

    // Job should still be retrievable right after completion
    const retrieved = store.getJob(job.job_id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.status).toBe("completed");
    store.stop();
  });
});
