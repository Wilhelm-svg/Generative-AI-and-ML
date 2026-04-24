/**
 * Unit + property-based tests for InMemoryPredictionStore (async interface)
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import { InMemoryPredictionStore } from "./store";
import type { StoredPrediction } from "./types";

function makePrediction(overrides: Partial<StoredPrediction> = {}): StoredPrediction {
  return {
    id: Math.random().toString(36).slice(2),
    timestamp: new Date().toISOString(),
    input: { tenure: 24 },
    label: "churn",
    confidence: 0.7,
    explanation: [
      { feature: "tenure", impact: "positive", magnitude: 0.3 },
      { feature: "MonthlyCharges", impact: "negative", magnitude: 0.2 },
      { feature: "TotalCharges", impact: "negative", magnitude: 0.1 },
    ],
    recommendation: "Test recommendation",
    ...overrides,
  };
}

describe("InMemoryPredictionStore", () => {
  let store: InMemoryPredictionStore;

  beforeEach(() => {
    store = new InMemoryPredictionStore();
  });

  it("starts empty", async () => {
    expect(await store.getAll()).toHaveLength(0);
  });

  it("add and getAll", async () => {
    const p = makePrediction();
    await store.add(p);
    const all = await store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(p);
  });

  it("getById returns the correct prediction", async () => {
    const p = makePrediction({ id: "abc" });
    await store.add(p);
    expect(await store.getById("abc")).toEqual(p);
  });

  it("getById returns undefined for unknown id", async () => {
    expect(await store.getById("nope")).toBeUndefined();
  });

  it("getByLabel returns only matching predictions", async () => {
    await store.add(makePrediction({ id: "1", label: "churn" }));
    await store.add(makePrediction({ id: "2", label: "no-churn" }));
    await store.add(makePrediction({ id: "3", label: "churn" }));

    const churns = await store.getByLabel("churn");
    expect(churns).toHaveLength(2);
    expect(churns.every((p) => p.label === "churn")).toBe(true);
  });

  it("getLabelDistribution counts correctly", async () => {
    await store.add(makePrediction({ label: "churn" }));
    await store.add(makePrediction({ label: "churn" }));
    await store.add(makePrediction({ label: "no-churn" }));

    const dist = await store.getLabelDistribution();
    expect(dist["churn"]).toBe(2);
    expect(dist["no-churn"]).toBe(1);
  });

  it("getAll returns a copy (mutations don't affect store)", async () => {
    await store.add(makePrediction({ id: "x" }));
    const all = await store.getAll();
    all.push(makePrediction({ id: "y" }));
    expect(await store.getAll()).toHaveLength(1);
  });
});

// Property 6: Label filter returns only matching records
describe("Property 6: Label filter returns only matching records", () => {
  it("getByLabel always returns only records with the requested label", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: fc.uuid(),
            label: fc.oneof(fc.constant("churn"), fc.constant("no-churn"), fc.constant("fraud")),
            confidence: fc.float({ min: 0, max: 1, noNaN: true }),
          }),
          { minLength: 0, maxLength: 50 }
        ),
        fc.oneof(fc.constant("churn"), fc.constant("no-churn"), fc.constant("fraud")),
        async (items, filterLabel) => {
          const s = new InMemoryPredictionStore();
          for (const item of items) {
            await s.add(makePrediction({ id: item.id, label: item.label, confidence: item.confidence }));
          }
          const filtered = await s.getByLabel(filterLabel);
          return filtered.every((p) => p.label === filterLabel);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// Property 7: Chart distribution matches actual label counts
describe("Property 7: Chart distribution matches actual label counts", () => {
  it("getLabelDistribution exactly matches the frequency of each label", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof(fc.constant("churn"), fc.constant("no-churn"), fc.constant("fraud")),
          { minLength: 0, maxLength: 100 }
        ),
        async (labels) => {
          const s = new InMemoryPredictionStore();
          for (const label of labels) {
            await s.add(makePrediction({ id: Math.random().toString(36), label }));
          }
          const dist = await s.getLabelDistribution();
          const expected: Record<string, number> = {};
          for (const label of labels) {
            expected[label] = (expected[label] ?? 0) + 1;
          }
          for (const [label, count] of Object.entries(expected)) {
            if (dist[label] !== count) return false;
          }
          for (const label of Object.keys(dist)) {
            if (dist[label] !== (expected[label] ?? 0)) return false;
          }
          return true;
        }
      ),
      { numRuns: 200 }
    );
  });
});
