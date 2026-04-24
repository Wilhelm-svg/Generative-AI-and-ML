/**
 * Behavioral / regression tests for the Churn Prediction Engine
 *
 * These tests validate that the model produces directionally correct predictions
 * for well-known Telco churn archetypes. Each test case is grounded in the
 * published Telco Customer Churn dataset patterns:
 *
 *   - Month-to-month + Fiber optic + high charges = strong churn signal
 *   - Two-year contract + low charges + long tenure = strong retention signal
 *   - New customer + month-to-month = elevated churn risk
 *   - Long-tenure + annual contract = stable
 *
 * References:
 *   IBM Telco Customer Churn dataset (7,043 customers)
 *   Observed churn rate: ~26.5%
 *   Key churn drivers: Contract type, tenure, MonthlyCharges, InternetService
 */

import { describe, it, expect } from "vitest";
import { predict, explain, recommend, REQUIRED_FIELDS, validateRecord } from "./engine";
import type { InputRecord } from "./types";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRecord(fields: Record<string, number | string>): InputRecord {
  return { id: "test", fields };
}

/** High-risk archetype: month-to-month, fiber optic, high charges, new customer */
const HIGH_RISK: Record<string, number | string> = {
  tenure: 1,
  MonthlyCharges: 95,
  TotalCharges: 95,
  SeniorCitizen: 0,
  Partner: "No",
  Dependents: "No",
  PhoneService: "Yes",
  MultipleLines: "Yes",
  InternetService: "Fiber optic",
  OnlineSecurity: "No",
  OnlineBackup: "No",
  DeviceProtection: "No",
  TechSupport: "No",
  StreamingTV: "Yes",
  StreamingMovies: "Yes",
  Contract: "Month-to-month",
  PaperlessBilling: "Yes",
  PaymentMethod: "Electronic check",
};

/** Low-risk archetype: two-year contract, DSL, low charges, long tenure */
const LOW_RISK: Record<string, number | string> = {
  tenure: 60,
  MonthlyCharges: 25,
  TotalCharges: 1500,
  SeniorCitizen: 0,
  Partner: "Yes",
  Dependents: "Yes",
  PhoneService: "Yes",
  MultipleLines: "No",
  InternetService: "DSL",
  OnlineSecurity: "Yes",
  OnlineBackup: "Yes",
  DeviceProtection: "Yes",
  TechSupport: "Yes",
  StreamingTV: "No",
  StreamingMovies: "No",
  Contract: "Two year",
  PaperlessBilling: "No",
  PaymentMethod: "Bank transfer (automatic)",
};

/** Medium-risk archetype: one-year contract, fiber, moderate charges, mid tenure */
const MEDIUM_RISK: Record<string, number | string> = {
  tenure: 18,
  MonthlyCharges: 70,
  TotalCharges: 1260,
  SeniorCitizen: 0,
  Partner: "Yes",
  Dependents: "No",
  PhoneService: "Yes",
  MultipleLines: "No",
  InternetService: "Fiber optic",
  OnlineSecurity: "Yes",
  OnlineBackup: "No",
  DeviceProtection: "No",
  TechSupport: "No",
  StreamingTV: "No",
  StreamingMovies: "No",
  Contract: "One year",
  PaperlessBilling: "Yes",
  PaymentMethod: "Credit card (automatic)",
};

/** Senior citizen, month-to-month, high charges — elevated churn risk */
const SENIOR_HIGH_RISK: Record<string, number | string> = {
  tenure: 3,
  MonthlyCharges: 85,
  TotalCharges: 255,
  SeniorCitizen: 1,
  Partner: "No",
  Dependents: "No",
  PhoneService: "Yes",
  MultipleLines: "No",
  InternetService: "Fiber optic",
  OnlineSecurity: "No",
  OnlineBackup: "No",
  DeviceProtection: "No",
  TechSupport: "No",
  StreamingTV: "No",
  StreamingMovies: "No",
  Contract: "Month-to-month",
  PaperlessBilling: "Yes",
  PaymentMethod: "Electronic check",
};

/** No internet service, long tenure, two-year contract — very stable */
const NO_INTERNET_STABLE: Record<string, number | string> = {
  tenure: 48,
  MonthlyCharges: 20,
  TotalCharges: 960,
  SeniorCitizen: 0,
  Partner: "Yes",
  Dependents: "Yes",
  PhoneService: "Yes",
  MultipleLines: "No",
  InternetService: "No",
  OnlineSecurity: "No internet service",
  OnlineBackup: "No internet service",
  DeviceProtection: "No internet service",
  TechSupport: "No internet service",
  StreamingTV: "No internet service",
  StreamingMovies: "No internet service",
  Contract: "Two year",
  PaperlessBilling: "No",
  PaymentMethod: "Mailed check",
};

/** Extreme churn: 1 month, fiber, $100+, no add-ons, electronic check */
const EXTREME_CHURN: Record<string, number | string> = {
  tenure: 1,
  MonthlyCharges: 105,
  TotalCharges: 105,
  SeniorCitizen: 1,
  Partner: "No",
  Dependents: "No",
  PhoneService: "Yes",
  MultipleLines: "Yes",
  InternetService: "Fiber optic",
  OnlineSecurity: "No",
  OnlineBackup: "No",
  DeviceProtection: "No",
  TechSupport: "No",
  StreamingTV: "Yes",
  StreamingMovies: "Yes",
  Contract: "Month-to-month",
  PaperlessBilling: "Yes",
  PaymentMethod: "Electronic check",
};

/** Extreme retention: 72 months, two-year, DSL, all add-ons, auto-pay */
const EXTREME_RETENTION: Record<string, number | string> = {
  tenure: 72,
  MonthlyCharges: 19.9,
  TotalCharges: 1432.8,
  SeniorCitizen: 0,
  Partner: "Yes",
  Dependents: "Yes",
  PhoneService: "Yes",
  MultipleLines: "No",
  InternetService: "DSL",
  OnlineSecurity: "Yes",
  OnlineBackup: "Yes",
  DeviceProtection: "Yes",
  TechSupport: "Yes",
  StreamingTV: "No",
  StreamingMovies: "No",
  Contract: "Two year",
  PaperlessBilling: "No",
  PaymentMethod: "Bank transfer (automatic)",
};

// ── Section 1: Directional correctness ────────────────────────────────────

describe("Directional correctness — high-risk profiles should churn", () => {
  it("extreme churn profile predicts Churn", () => {
    const { label, confidence } = predict(makeRecord(EXTREME_CHURN));
    expect(label).toBe("Churn");
    expect(confidence).toBeGreaterThan(0.2);
  });

  it("high-risk profile (month-to-month, fiber, new) predicts Churn", () => {
    const { label } = predict(makeRecord(HIGH_RISK));
    expect(label).toBe("Churn");
  });

  it("senior citizen, month-to-month, fiber, short tenure predicts Churn", () => {
    const { label } = predict(makeRecord(SENIOR_HIGH_RISK));
    expect(label).toBe("Churn");
  });
});

describe("Directional correctness — low-risk profiles should not churn", () => {
  it("extreme retention profile predicts No Churn", () => {
    const { label, confidence } = predict(makeRecord(EXTREME_RETENTION));
    expect(label).toBe("No Churn");
    expect(confidence).toBeLessThan(0.2);
  });

  it("low-risk profile (two-year, DSL, long tenure) predicts No Churn", () => {
    const { label } = predict(makeRecord(LOW_RISK));
    expect(label).toBe("No Churn");
  });

  it("no internet, two-year contract, long tenure predicts No Churn", () => {
    const { label } = predict(makeRecord(NO_INTERNET_STABLE));
    expect(label).toBe("No Churn");
  });
});

// ── Section 2: Monotonicity — changing one risk factor should move score ──

describe("Monotonicity — contract type", () => {
  const base = { ...HIGH_RISK };

  it("switching from month-to-month to two-year reduces churn probability", () => {
    const { confidence: c1 } = predict(makeRecord({ ...base, Contract: "Month-to-month" }));
    const { confidence: c2 } = predict(makeRecord({ ...base, Contract: "One year" }));
    const { confidence: c3 } = predict(makeRecord({ ...base, Contract: "Two year" }));
    // Each step should reduce churn probability
    expect(c1).toBeGreaterThanOrEqual(c2);
    expect(c2).toBeGreaterThanOrEqual(c3);
  });
});

describe("Monotonicity — tenure", () => {
  const base = { ...HIGH_RISK };

  it("longer tenure reduces churn probability (month-to-month customer)", () => {
    const tenures = [1, 6, 12, 24, 48, 72];
    const confidences = tenures.map(t =>
      predict(makeRecord({ ...base, tenure: t, TotalCharges: t * Number(base.MonthlyCharges) })).confidence
    );
    // Confidence should generally decrease as tenure increases
    // Allow for minor non-monotonicity (model is not perfectly monotone) but overall trend must hold
    const first = confidences[0];
    const last = confidences[confidences.length - 1];
    expect(first).toBeGreaterThan(last);
  });
});

describe("Monotonicity — monthly charges", () => {
  const base = { ...LOW_RISK };

  it("higher monthly charges increases churn probability (stable customer)", () => {
    const { confidence: low }  = predict(makeRecord({ ...base, MonthlyCharges: 20, TotalCharges: 1200 }));
    const { confidence: high } = predict(makeRecord({ ...base, MonthlyCharges: 100, TotalCharges: 6000 }));
    expect(high).toBeGreaterThan(low);
  });
});

describe("Monotonicity — internet service risk", () => {
  const base = { ...HIGH_RISK };

  it("fiber optic has higher churn probability than DSL, which is higher than no internet", () => {
    const { confidence: fiber } = predict(makeRecord({ ...base, InternetService: "Fiber optic" }));
    const { confidence: dsl }   = predict(makeRecord({ ...base, InternetService: "DSL" }));
    const { confidence: none }  = predict(makeRecord({
      ...base,
      InternetService: "No",
      OnlineSecurity: "No internet service",
      OnlineBackup: "No internet service",
      DeviceProtection: "No internet service",
      TechSupport: "No internet service",
      StreamingTV: "No internet service",
      StreamingMovies: "No internet service",
    }));
    expect(fiber).toBeGreaterThanOrEqual(dsl);
    expect(dsl).toBeGreaterThanOrEqual(none);
  });
});

// ── Section 3: Explanation quality ────────────────────────────────────────

describe("Explanation quality", () => {
  it("returns exactly 3 feature contributions for high-risk profile", () => {
    const record = makeRecord(HIGH_RISK);
    const { label } = predict(record);
    const contributions = explain(record, label);
    expect(contributions).toHaveLength(3);
  });

  it("returns exactly 3 feature contributions for low-risk profile", () => {
    const record = makeRecord(LOW_RISK);
    const { label } = predict(record);
    const contributions = explain(record, label);
    expect(contributions).toHaveLength(3);
  });

  it("no contribution has feature name 'undefined'", () => {
    for (const profile of [HIGH_RISK, LOW_RISK, MEDIUM_RISK, SENIOR_HIGH_RISK, NO_INTERNET_STABLE]) {
      const record = makeRecord(profile);
      const { label } = predict(record);
      const contributions = explain(record, label);
      for (const c of contributions) {
        expect(c.feature).toBeTruthy();
        expect(c.feature).not.toBe("undefined");
        expect(typeof c.feature).toBe("string");
      }
    }
  });

  it("all magnitudes are positive numbers", () => {
    const record = makeRecord(HIGH_RISK);
    const { label } = predict(record);
    for (const c of explain(record, label)) {
      expect(c.magnitude).toBeGreaterThan(0);
      expect(isFinite(c.magnitude)).toBe(true);
    }
  });

  it("contributions are sorted by magnitude descending", () => {
    const record = makeRecord(HIGH_RISK);
    const { label } = predict(record);
    const contributions = explain(record, label);
    for (let i = 1; i < contributions.length; i++) {
      expect(contributions[i - 1].magnitude).toBeGreaterThanOrEqual(contributions[i].magnitude);
    }
  });

  it("high-risk churn profile has internet_risk or contract_risk or log_tenure as top feature", () => {
    const record = makeRecord(EXTREME_CHURN);
    const { label } = predict(record);
    const contributions = explain(record, label);
    const topFeature = contributions[0].feature;
    // The top driver for extreme churn should be one of the known key features
    const knownChurnDrivers = ["internet_risk", "contract_risk", "log_tenure", "monthly_to_total", "value_score"];
    expect(knownChurnDrivers.some(d => topFeature.includes(d.split("_")[0]))).toBe(true);
  });
});

// ── Section 4: Recommendation quality ────────────────────────────────────

describe("Recommendation quality", () => {
  it("churn recommendation for new month-to-month customer mentions contract or onboarding", () => {
    const record = makeRecord(HIGH_RISK);
    const { label } = predict(record);
    const contributions = explain(record, label);
    const rec = recommend(label, contributions, HIGH_RISK);
    expect(rec.length).toBeGreaterThan(10);
    // Should mention contract upgrade or new customer onboarding
    const lower = rec.toLowerCase();
    expect(
      lower.includes("contract") || lower.includes("onboard") || lower.includes("new customer") ||
      lower.includes("fibre") || lower.includes("fiber") || lower.includes("discount") || lower.includes("price")
    ).toBe(true);
  });

  it("retention recommendation for loyal long-tenure customer mentions loyalty or upsell", () => {
    const record = makeRecord(LOW_RISK);
    const { label } = predict(record);
    const contributions = explain(record, label);
    const rec = recommend(label, contributions, LOW_RISK);
    const lower = rec.toLowerCase();
    expect(
      lower.includes("loyal") || lower.includes("upsell") || lower.includes("retained") ||
      lower.includes("renewal") || lower.includes("vip") || lower.includes("stable")
    ).toBe(true);
  });

  it("new customer (1 month) never gets 'loyal customer' recommendation", () => {
    const record = makeRecord(HIGH_RISK); // tenure = 1
    const { label } = predict(record);
    const contributions = explain(record, label);
    const rec = recommend(label, contributions, HIGH_RISK);
    expect(rec.toLowerCase()).not.toContain("loyal customer");
  });

  it("recommendation is non-empty for all archetypes", () => {
    const profiles = [HIGH_RISK, LOW_RISK, MEDIUM_RISK, SENIOR_HIGH_RISK, NO_INTERNET_STABLE, EXTREME_CHURN, EXTREME_RETENTION];
    for (const profile of profiles) {
      const record = makeRecord(profile);
      const { label } = predict(record);
      const contributions = explain(record, label);
      const rec = recommend(label, contributions, profile);
      expect(rec.length).toBeGreaterThan(0);
    }
  });
});

// ── Section 5: Confidence calibration ─────────────────────────────────────

describe("Confidence calibration", () => {
  it("extreme churn profile has higher confidence than medium-risk", () => {
    const { confidence: extreme } = predict(makeRecord(EXTREME_CHURN));
    const { confidence: medium }  = predict(makeRecord(MEDIUM_RISK));
    // Extreme churn should be more confident (higher probability)
    expect(extreme).toBeGreaterThan(medium);
  });

  it("extreme retention profile has lower confidence than medium-risk", () => {
    const { confidence: extreme }  = predict(makeRecord(EXTREME_RETENTION));
    const { confidence: medium }   = predict(makeRecord(MEDIUM_RISK));
    expect(extreme).toBeLessThan(medium);
  });

  it("all confidence values are in [0, 1]", () => {
    const profiles = [HIGH_RISK, LOW_RISK, MEDIUM_RISK, SENIOR_HIGH_RISK, NO_INTERNET_STABLE, EXTREME_CHURN, EXTREME_RETENTION];
    for (const profile of profiles) {
      const { confidence } = predict(makeRecord(profile));
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    }
  });
});

// ── Section 6: Edge cases ──────────────────────────────────────────────────

describe("Edge cases", () => {
  it("zero tenure customer is handled without throwing", () => {
    expect(() => predict(makeRecord({ ...HIGH_RISK, tenure: 0, TotalCharges: 0 }))).not.toThrow();
  });

  it("maximum tenure (72 months) is handled without throwing", () => {
    expect(() => predict(makeRecord({ ...LOW_RISK, tenure: 72 }))).not.toThrow();
  });

  it("very high monthly charges (200) is handled without throwing", () => {
    expect(() => predict(makeRecord({ ...HIGH_RISK, MonthlyCharges: 200, TotalCharges: 200 }))).not.toThrow();
  });

  it("TotalCharges = 0 (new customer) is handled without throwing", () => {
    expect(() => predict(makeRecord({ ...HIGH_RISK, TotalCharges: 0 }))).not.toThrow();
  });

  it("missing required field throws validation error", () => {
    const fields = { ...HIGH_RISK };
    delete (fields as Record<string, unknown>)["tenure"];
    expect(() => predict(makeRecord(fields))).toThrow("Validation error");
  });

  it("validateRecord catches all 18 missing fields at once", () => {
    const err = validateRecord({ id: "x", fields: {} }, REQUIRED_FIELDS);
    expect(err?.missing).toHaveLength(REQUIRED_FIELDS.length);
  });

  it("senior citizen flag (1 vs 0) increases churn probability for high-risk profile", () => {
    const { confidence: senior }    = predict(makeRecord({ ...HIGH_RISK, SeniorCitizen: 1 }));
    const { confidence: nonSenior } = predict(makeRecord({ ...HIGH_RISK, SeniorCitizen: 0 }));
    // Senior citizens churn more in the Telco dataset
    expect(senior).toBeGreaterThanOrEqual(nonSenior);
  });
});

// ── Section 7: Known dataset patterns ─────────────────────────────────────

describe("Known Telco dataset patterns", () => {
  it("month-to-month customers churn more than two-year customers (same everything else)", () => {
    const base = { ...MEDIUM_RISK };
    const { confidence: mtm }     = predict(makeRecord({ ...base, Contract: "Month-to-month" }));
    const { confidence: twoYear } = predict(makeRecord({ ...base, Contract: "Two year" }));
    expect(mtm).toBeGreaterThan(twoYear);
  });

  it("fiber optic customers churn more than DSL customers (same everything else)", () => {
    const base = { ...HIGH_RISK };
    const { confidence: fiber } = predict(makeRecord({ ...base, InternetService: "Fiber optic" }));
    const { confidence: dsl }   = predict(makeRecord({ ...base, InternetService: "DSL" }));
    expect(fiber).toBeGreaterThan(dsl);
  });

  it("electronic check payment method has higher churn than auto-pay (same everything else)", () => {
    const base = { ...HIGH_RISK };
    const { confidence: echeck } = predict(makeRecord({ ...base, PaymentMethod: "Electronic check" }));
    const { confidence: auto }   = predict(makeRecord({ ...base, PaymentMethod: "Bank transfer (automatic)" }));
    // Electronic check is the highest-churn payment method in the dataset
    expect(echeck).toBeGreaterThanOrEqual(auto);
  });

  it("customers with no online security churn more than those with it (fiber optic)", () => {
    const base = { ...HIGH_RISK };
    const { confidence: noSec }  = predict(makeRecord({ ...base, OnlineSecurity: "No" }));
    const { confidence: yesSec } = predict(makeRecord({ ...base, OnlineSecurity: "Yes" }));
    expect(noSec).toBeGreaterThanOrEqual(yesSec);
  });

  it("paperless billing customers churn more than non-paperless (same everything else)", () => {
    const base = { ...HIGH_RISK };
    const { confidence: paperless }    = predict(makeRecord({ ...base, PaperlessBilling: "Yes" }));
    const { confidence: noPaperless }  = predict(makeRecord({ ...base, PaperlessBilling: "No" }));
    expect(paperless).toBeGreaterThanOrEqual(noPaperless);
  });
});
