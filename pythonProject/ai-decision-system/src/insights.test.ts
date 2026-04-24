/**
 * Unit + property-based tests for the Insight Generator
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { generateInsights } from "./insights";
import type { StoredPrediction } from "./types";

function makePrediction(label = "churn", confidence = 0.7): StoredPrediction {
  return {
    id: Math.random().toString(36).slice(2),
    timestamp: new Date().toISOString(),
    input: { age: 35 },
    label,
    confidence,
    explanation: [
      { feature: "isActiveMember", impact: "negative", magnitude: 0.4 },
      { feature: "numProducts", impact: "negative", magnitude: 0.25 },
      { feature: "tenure", impact: "negative", magnitude: 0.15 },
    ],
    recommendation: "Test recommendation",
  };
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe("generateInsights", () => {
  it("returns empty array for 0 predictions", () => {
    expect(generateInsights([])).toHaveLength(0);
  });

  it("returns empty array for 9 predictions (below threshold)", () => {
    const preds = Array.from({ length: 9 }, () => makePrediction());
    expect(generateInsights(preds)).toHaveLength(0);
  });

  it("returns at least 3 insights for exactly 10 predictions (boundary)", () => {
    const preds = Array.from({ length: 10 }, () => makePrediction());
    const insights = generateInsights(preds);
    expect(insights.length).toBeGreaterThanOrEqual(3);
  });

  it("returns at least 3 insights for 20 predictions", () => {
    const preds = Array.from({ length: 20 }, () => makePrediction());
    expect(generateInsights(preds).length).toBeGreaterThanOrEqual(3);
  });

  it("each insight has a non-empty statement string", () => {
    const preds = Array.from({ length: 10 }, () => makePrediction());
    for (const insight of generateInsights(preds)) {
      expect(typeof insight.statement).toBe("string");
      expect(insight.statement.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 5: Insights threshold behavior
// Validates: Requirements 2.1, 2.3
// ---------------------------------------------------------------------------

describe("Property 5: Insights threshold behavior", () => {
  it("fewer than 10 predictions → empty insights", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9 }),
        (count) => {
          const preds = Array.from({ length: count }, () => makePrediction());
          return generateInsights(preds).length === 0;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("10 or more predictions → at least 3 insights", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 100 }),
        fc.array(
          fc.oneof(fc.constant("churn"), fc.constant("no-churn")),
          { minLength: 10, maxLength: 100 }
        ),
        (count, labels) => {
          // Use exactly `count` labels (pad or trim)
          const usedLabels = labels.slice(0, count);
          while (usedLabels.length < count) usedLabels.push("churn");

          const preds = usedLabels.map((label) => makePrediction(label));
          return generateInsights(preds).length >= 3;
        }
      ),
      { numRuns: 100 }
    );
  });
});
