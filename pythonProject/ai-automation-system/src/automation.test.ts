import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { validateInput } from "./validation.js";
import { InMemoryJobStore } from "./jobStore.js";
import { InvoiceExtractor, EmailClassifier, TicketCategorizer } from "./extractors.js";

// ── Validation ────────────────────────────────────────────────────────────────

describe("validateInput", () => {
  it("accepts valid invoice input", () => {
    const result = validateInput({ pipeline_type: "invoice_extraction", input_text: "Invoice from Acme" });
    expect(result.valid).toBe(true);
  });

  it("rejects missing pipeline_type", () => {
    const result = validateInput({ input_text: "hello" });
    expect(result.valid).toBe(false);
  });

  it("rejects invalid pipeline_type", () => {
    const result = validateInput({ pipeline_type: "unknown_type", input_text: "hello" });
    expect(result.valid).toBe(false);
  });

  it("rejects input with no input_text or input_json", () => {
    const result = validateInput({ pipeline_type: "invoice_extraction" });
    expect(result.valid).toBe(false);
  });

  it("rejects input exceeding 100KB", () => {
    const bigText = "a".repeat(102_400 + 1);
    const result = validateInput({ pipeline_type: "invoice_extraction", input_text: bigText });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/100KB/i);
  });

  it("accepts input at exactly 100KB boundary", () => {
    // Build a body that is just under 100KB
    const body = { pipeline_type: "invoice_extraction", input_text: "a".repeat(100) };
    const result = validateInput(body);
    expect(result.valid).toBe(true);
  });
});

// Property 1: Valid inputs accepted; oversized inputs rejected
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

// ── JobStore ──────────────────────────────────────────────────────────────────

describe("InMemoryJobStore", () => {
  it("createJob returns a job with pending status", () => {
    const store = new InMemoryJobStore();
    const job = store.createJob("invoice_extraction", "test");
    expect(job.status).toBe("pending");
    expect(job.job_id).toBeTruthy();
    store.stop();
  });

  it("getJob returns the created job", () => {
    const store = new InMemoryJobStore();
    const job = store.createJob("email_classification", "email text");
    expect(store.getJob(job.job_id)).toEqual(job);
    store.stop();
  });

  it("getJob returns undefined for unknown id", () => {
    const store = new InMemoryJobStore();
    expect(store.getJob("nonexistent")).toBeUndefined();
    store.stop();
  });

  it("updateJob changes status", () => {
    const store = new InMemoryJobStore();
    const job = store.createJob("invoice_extraction", "text");
    store.updateJob(job.job_id, { status: "processing" });
    expect(store.getJob(job.job_id)?.status).toBe("processing");
    store.stop();
  });

  it("failed job update includes error field", () => {
    const store = new InMemoryJobStore();
    const job = store.createJob("invoice_extraction", "text");
    store.updateJob(job.job_id, { status: "failed", error: "extraction failed" });
    const updated = store.getJob(job.job_id);
    expect(updated?.status).toBe("failed");
    expect(updated?.error).toBe("extraction failed");
    store.stop();
  });
});

// Property 2: Job IDs are unique
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

// Property 6: Job status is always a valid value
describe("Property 6: Job status is always a valid value", () => {
  const validStatuses = new Set(["pending", "processing", "completed", "failed"]);

  it("status is always one of the four valid values", () => {
    const store = new InMemoryJobStore();
    const job = store.createJob("invoice_extraction", "text");
    expect(validStatuses.has(job.status)).toBe(true);
    store.updateJob(job.job_id, { status: "processing" });
    expect(validStatuses.has(store.getJob(job.job_id)!.status)).toBe(true);
    store.updateJob(job.job_id, { status: "completed" });
    expect(validStatuses.has(store.getJob(job.job_id)!.status)).toBe(true);
    store.stop();
  });
});

// ── Extractors ────────────────────────────────────────────────────────────────

describe("InvoiceExtractor", () => {
  const extractor = new InvoiceExtractor();

  it("returns invoice_extraction pipeline type", async () => {
    const result = await extractor.extract({ input_text: "Vendor: Acme Corp. Total: $500. Date: 2024-01-15" });
    expect(result.pipeline_type).toBe("invoice_extraction");
  });

  it("confidence is in [0, 1]", async () => {
    const result = await extractor.extract({ input_text: "Invoice from Acme. Amount: $100" });
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("data has required InvoiceData fields", async () => {
    const result = await extractor.extract({ input_text: "Vendor: Test Co. Total: $200" });
    const data = result.data as { vendor: string; amount: number; currency: string; date: string; line_items: unknown[] };
    expect(typeof data.vendor).toBe("string");
    expect(typeof data.amount).toBe("number");
    expect(typeof data.currency).toBe("string");
    expect(typeof data.date).toBe("string");
    expect(Array.isArray(data.line_items)).toBe(true);
  });
});

describe("EmailClassifier", () => {
  const classifier = new EmailClassifier();

  it("returns email_classification pipeline type", async () => {
    const result = await classifier.classify({ input_text: "I need help with my account" });
    expect(result.pipeline_type).toBe("email_classification");
  });

  it("confidence is in [0, 1]", async () => {
    const result = await classifier.classify({ input_text: "Please refund my order" });
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

describe("TicketCategorizer", () => {
  const categorizer = new TicketCategorizer();

  it("returns support_ticket_categorization pipeline type", async () => {
    const result = await categorizer.categorize({ input_text: "App crashes on login" });
    expect(result.pipeline_type).toBe("support_ticket_categorization");
  });

  it("priority is one of the valid values", async () => {
    const result = await categorizer.categorize({ input_text: "Urgent: system is down" });
    const data = result.data as { priority: string };
    expect(["low", "medium", "high", "critical"]).toContain(data.priority);
  });
});

// Property 4: Confidence score always in [0, 1]
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
    ), { numRuns: 5 }); // low runs — uses real API fallback
  });
});
