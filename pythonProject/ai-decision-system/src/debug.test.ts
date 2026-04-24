import { describe, it } from "vitest";
import { predict } from "./engine";
import type { InputRecord } from "./types";

const HIGH_RISK: Record<string, number | string> = {
  tenure: 1, MonthlyCharges: 95, TotalCharges: 95, SeniorCitizen: 0,
  Partner: "No", Dependents: "No", PhoneService: "Yes", MultipleLines: "Yes",
  InternetService: "Fiber optic", OnlineSecurity: "No", OnlineBackup: "No",
  DeviceProtection: "No", TechSupport: "No", StreamingTV: "Yes", StreamingMovies: "Yes",
  Contract: "Month-to-month", PaperlessBilling: "Yes", PaymentMethod: "Electronic check",
};

describe("debug scores", () => {
  it("prints actual confidence values", () => {
    const profiles: Record<string, Record<string, number | string>> = {
      "HIGH_RISK (1mo, fiber, mtm, $95)": HIGH_RISK,
      "HIGH_RISK + 2yr contract": { ...HIGH_RISK, Contract: "Two year" },
      "HIGH_RISK + 12mo tenure": { ...HIGH_RISK, tenure: 12, TotalCharges: 1140 },
      "HIGH_RISK + 24mo tenure": { ...HIGH_RISK, tenure: 24, TotalCharges: 2280 },
      "MEDIUM (18mo, fiber, 1yr, $70)": {
        tenure: 18, MonthlyCharges: 70, TotalCharges: 1260, SeniorCitizen: 0,
        Partner: "Yes", Dependents: "No", PhoneService: "Yes", MultipleLines: "No",
        InternetService: "Fiber optic", OnlineSecurity: "Yes", OnlineBackup: "No",
        DeviceProtection: "No", TechSupport: "No", StreamingTV: "No", StreamingMovies: "No",
        Contract: "One year", PaperlessBilling: "Yes", PaymentMethod: "Credit card (automatic)",
      },
      "LOW_RISK (60mo, DSL, 2yr, $25)": {
        tenure: 60, MonthlyCharges: 25, TotalCharges: 1500, SeniorCitizen: 0,
        Partner: "Yes", Dependents: "Yes", PhoneService: "Yes", MultipleLines: "No",
        InternetService: "DSL", OnlineSecurity: "Yes", OnlineBackup: "Yes",
        DeviceProtection: "Yes", TechSupport: "Yes", StreamingTV: "No", StreamingMovies: "No",
        Contract: "Two year", PaperlessBilling: "No", PaymentMethod: "Bank transfer (automatic)",
      },
      "EXTREME RETENTION (72mo, DSL, 2yr, $20)": {
        tenure: 72, MonthlyCharges: 19.9, TotalCharges: 1432.8, SeniorCitizen: 0,
        Partner: "Yes", Dependents: "Yes", PhoneService: "Yes", MultipleLines: "No",
        InternetService: "DSL", OnlineSecurity: "Yes", OnlineBackup: "Yes",
        DeviceProtection: "Yes", TechSupport: "Yes", StreamingTV: "No", StreamingMovies: "No",
        Contract: "Two year", PaperlessBilling: "No", PaymentMethod: "Bank transfer (automatic)",
      },
      "NO INTERNET (48mo, 2yr, $20)": {
        tenure: 48, MonthlyCharges: 20, TotalCharges: 960, SeniorCitizen: 0,
        Partner: "Yes", Dependents: "Yes", PhoneService: "Yes", MultipleLines: "No",
        InternetService: "No",
        OnlineSecurity: "No internet service", OnlineBackup: "No internet service",
        DeviceProtection: "No internet service", TechSupport: "No internet service",
        StreamingTV: "No internet service", StreamingMovies: "No internet service",
        Contract: "Two year", PaperlessBilling: "No", PaymentMethod: "Mailed check",
      },
    };

    for (const [name, fields] of Object.entries(profiles)) {
      const { label, confidence } = predict({ id: "x", fields });
      console.log(`${name}: ${label} (${(confidence * 100).toFixed(2)}%)`);
    }
  });
});
