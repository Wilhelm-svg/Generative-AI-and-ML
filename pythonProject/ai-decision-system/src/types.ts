/**
 * Core type definitions for the AI Decision System
 */

/** A single input data row submitted for prediction */
export interface InputRecord {
  id: string;
  fields: Record<string, number | string>;
}

/** Response returned by the prediction engine */
export interface PredictionResponse {
  id: string;
  label: string;
  confidence: number; // 0–1
  explanation: FeatureContribution[]; // top 3
  recommendation: string;
}

/** A single feature's contribution to a prediction */
export interface FeatureContribution {
  feature: string;
  impact: "positive" | "negative";
  magnitude: number;
}

/** A prediction record as stored in the prediction store */
export interface StoredPrediction {
  id: string;
  timestamp: string;
  input: Record<string, unknown>;
  label: string;
  confidence: number;
  explanation: FeatureContribution[];
  recommendation: string;
}

/** Validation error returned when required fields are missing */
export interface ValidationError {
  error: "MISSING_FIELDS";
  missing: string[];
}

/** A plain-language insight derived from prediction patterns */
export interface Insight {
  statement: string;
}
