/**
 * Unit + property-based tests for the Prediction Engine
 *
 * Run with: npm test
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  validateRecord,
  predict,
  explain,
  recommend,
  REQUIRED_FIELDS,
} from "./engine";
import type { InputRecord } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<Record<string, number | string>> = {}): InputRecord {
  return {
    id: "test-id",
    fields: {
      tenure: 24,
      MonthlyCharges: 65.5,
      TotalCharges: 1572,
      SeniorCitizen: 0,
      Partner: "Yes",
      Dependents: "No",
      PhoneService: "Yes",
      MultipleLines: "No",
      InternetService: "DSL",
      OnlineSecurity: "No",
      OnlineBackup: "No",
      DeviceProtection: "No",
      TechSupport: "No",
      StreamingTV: "No",
      StreamingMovies: "No",
      Contract: "Month-to-month",
      PaperlessBilling: "Yes",
      PaymentMethod: "Electronic check",
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// Unit tests — validateRecord
// ---------------------------------------------------------------------------

describe("validateRecord", () => {
  it("returns null for a valid record", () => {
    expect(validateRecord(makeRecord(), REQUIRED_FIELDS)).toBeNull();
  });

  it("returns MISSING_FIELDS when a required field is absent", () => {
    const record = makeRecord();
    delete (record.fields as Record<string, unknown>)["tenure"];
    const err = validateRecord(record, REQUIRED_FIELDS);
    expect(err).not.toBeNull();
    expect(err?.error).toBe("MISSING_FIELDS");
    expect(err?.missing).toContain("tenure");
  });

  it("lists all missing fields", () => {
    const record = { id: "x", fields: {} };
    const err = validateRecord(record, REQUIRED_FIELDS);
    expect(err?.missing.sort()).toEqual([...REQUIRED_FIELDS].sort());
  });

  it("returns MISSING_FIELDS for a non-object input", () => {
    const err = validateRecord(null, REQUIRED_FIELDS);
    expect(err?.error).toBe("MISSING_FIELDS");
  });
});

// ---------------------------------------------------------------------------
// Unit tests — predict
// ---------------------------------------------------------------------------

describe("predict", () => {
  it("returns a label and confidence in [0,1]", () => {
    const { label, confidence } = predict(makeRecord());
    expect(["Churn", "No Churn"]).toContain(label);
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it("returns confidence exactly 0 or 1 at boundary inputs", () => {
    // Extreme high-risk
    const highRisk = makeRecord({ tenure: 0, MonthlyCharges: 200, TotalCharges: 0 });
    const { confidence: c1 } = predict(highRisk);
    expect(c1).toBeGreaterThanOrEqual(0);
    expect(c1).toBeLessThanOrEqual(1);

    // Extreme low-risk
    const lowRisk = makeRecord({ tenure: 72, MonthlyCharges: 20, TotalCharges: 1440 });
    const { confidence: c2 } = predict(lowRisk);
    expect(c2).toBeGreaterThanOrEqual(0);
    expect(c2).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — explain
// ---------------------------------------------------------------------------

describe("explain", () => {
  it("returns at least 1 feature contribution", () => {
    const record = makeRecord();
    const { label } = predict(record);
    const contributions = explain(record, label);
    expect(contributions.length).toBeGreaterThanOrEqual(1);
  });

  it("each contribution has feature, impact, and magnitude", () => {
    const record = makeRecord();
    const { label } = predict(record);
    for (const c of explain(record, label)) {
      expect(typeof c.feature).toBe("string");
      expect(["positive", "negative"]).toContain(c.impact);
      expect(typeof c.magnitude).toBe("number");
      expect(c.magnitude).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Unit tests — recommend
// ---------------------------------------------------------------------------

describe("recommend", () => {
  it("returns a non-empty string for Churn", () => {
    const record = makeRecord();
    const { label } = predict(record);
    const explanation = explain(record, label);
    const rec = recommend("Churn", explanation);
    expect(typeof rec).toBe("string");
    expect(rec.length).toBeGreaterThan(0);
  });

  it("returns a non-empty string for No Churn", () => {
    const record = makeRecord();
    const explanation = explain(record, "No Churn");
    const rec = recommend("No Churn", explanation);
    expect(rec.length).toBeGreaterThan(0);
  });

  it("returns a non-empty string for unknown labels", () => {
    const rec = recommend("unknown-label", []);
    expect(rec.length).toBeGreaterThan(0);
  });
});

// Shared arbitrary for a complete set of required fields (using real string values for categoricals)
const requiredFieldsArb = fc.record({
  tenure: fc.float({ min: 0, max: 72, noNaN: true }),
  MonthlyCharges: fc.float({ min: 0, max: 200, noNaN: true }),
  TotalCharges: fc.float({ min: 0, max: 10000, noNaN: true }),
  SeniorCitizen: fc.integer({ min: 0, max: 1 }),
  Partner: fc.constantFrom("Yes", "No"),
  Dependents: fc.constantFrom("Yes", "No"),
  PhoneService: fc.constantFrom("Yes", "No"),
  MultipleLines: fc.constantFrom("Yes", "No", "No phone service"),
  InternetService: fc.constantFrom("DSL", "Fiber optic", "No"),
  OnlineSecurity: fc.constantFrom("Yes", "No", "No internet service"),
  OnlineBackup: fc.constantFrom("Yes", "No", "No internet service"),
  DeviceProtection: fc.constantFrom("Yes", "No", "No internet service"),
  TechSupport: fc.constantFrom("Yes", "No", "No internet service"),
  StreamingTV: fc.constantFrom("Yes", "No", "No internet service"),
  StreamingMovies: fc.constantFrom("Yes", "No", "No internet service"),
  Contract: fc.constantFrom("Month-to-month", "One year", "Two year"),
  PaperlessBilling: fc.constantFrom("Yes", "No"),
  PaymentMethod: fc.constantFrom("Electronic check", "Mailed check", "Bank transfer (automatic)", "Credit card (automatic)"),
});

// ---------------------------------------------------------------------------
// Property 3: Missing-field records always produce a validation error
// Validates: Requirements 1.2
// ---------------------------------------------------------------------------

describe("Property 3: Missing-field records always produce a validation error", () => {
  it("any record missing at least one required field returns MISSING_FIELDS", () => {
    fc.assert(
      fc.property(
        fc.subarray(REQUIRED_FIELDS, { minLength: 1 }),
        requiredFieldsArb,
        (missingFields, allFields) => {
          const fields: Record<string, number | string> = { ...allFields };
          for (const f of missingFields) delete fields[f];
          const record = { id: "prop-test", fields };
          const err = validateRecord(record, REQUIRED_FIELDS);
          if (err === null) return false;
          if (err.error !== "MISSING_FIELDS") return false;
          return missingFields.every((f) => err.missing.includes(f));
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 1: Confidence score is always in [0, 1]
// Validates: Requirements 1.1
// ---------------------------------------------------------------------------

describe("Property 1: Confidence score is always in [0, 1]", () => {
  it("predict() always returns confidence in [0,1] for any numeric field values", () => {
    fc.assert(
      fc.property(
        requiredFieldsArb,
        (fields) => {
          const record: InputRecord = { id: "prop-test", fields };
          const { confidence } = predict(record);
          return confidence >= 0 && confidence <= 1;
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Explanation always contains at least 1 feature
// Validates: Requirements 1.3
// ---------------------------------------------------------------------------

describe("Property 2: Explanation always contains exactly 3 features", () => {
  it("explain() always returns exactly 3 FeatureContribution entries", () => {
    fc.assert(
      fc.property(
        requiredFieldsArb,
        (fields) => {
          const record: InputRecord = { id: "prop-test", fields };
          const { label } = predict(record);
          const contributions = explain(record, label);
          return contributions.length >= 1;
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Recommendation is always present with a prediction
// Validates: Requirements 3.1
// ---------------------------------------------------------------------------

describe("Property 4: Recommendation is always present with a prediction", () => {
  it("recommend() always returns a non-empty string", () => {
    fc.assert(
      fc.property(
        requiredFieldsArb,
        (fields) => {
          const record: InputRecord = { id: "prop-test", fields };
          const { label } = predict(record);
          const explanation = explain(record, label);
          const rec = recommend(label, explanation);
          return typeof rec === "string" && rec.length > 0;
        }
      ),
      { numRuns: 200 }
    );
  });
});
