/**
 * Insight generator — derives plain-language insights from stored predictions
 */

import type { StoredPrediction, Insight } from "./types";

const INSIGHTS_THRESHOLD = 10;

/**
 * Generate at least 3 plain-language insights from stored predictions.
 * Returns an empty array when fewer than INSIGHTS_THRESHOLD predictions exist.
 *
 * Validates: Requirements 2.1, 2.2, 2.3
 */
export function generateInsights(predictions: StoredPrediction[]): Insight[] {
  if (predictions.length < INSIGHTS_THRESHOLD) {
    return [];
  }

  const insights: Insight[] = [];
  const total = predictions.length;

  // --- Insight 1: Label distribution ---
  const labelCounts: Record<string, number> = {};
  for (const p of predictions) {
    labelCounts[p.label] = (labelCounts[p.label] ?? 0) + 1;
  }
  const topLabel = Object.entries(labelCounts).sort((a, b) => b[1] - a[1])[0];
  if (topLabel) {
    const pct = Math.round((topLabel[1] / total) * 100);
    insights.push({
      statement: `${pct}% of submitted records were classified as "${topLabel[0]}" (${topLabel[1]} of ${total} records).`,
    });
  }

  // --- Insight 2: Average confidence ---
  const validConfidences = predictions.filter(p => typeof p.confidence === 'number' && !isNaN(p.confidence));
  if (validConfidences.length > 0) {
    const avgConfidence = validConfidences.reduce((sum, p) => sum + p.confidence, 0) / validConfidences.length;
    insights.push({
      statement: `Average prediction confidence across all records is ${(avgConfidence * 100).toFixed(1)}%.`,
    });
  }

  // --- Insight 3: Most common top feature ---
  const featureCounts: Record<string, number> = {};
  for (const p of predictions) {
    const top = p.explanation[0]?.feature;
    if (top) featureCounts[top] = (featureCounts[top] ?? 0) + 1;
  }
  const topFeatureEntry = Object.entries(featureCounts).sort(
    (a, b) => b[1] - a[1]
  )[0];
  if (topFeatureEntry) {
    const pct = Math.round((topFeatureEntry[1] / total) * 100);
    insights.push({
      statement: `"${topFeatureEntry[0]}" is the most influential feature in ${pct}% of predictions.`,
    });
  }

  // --- Insight 4 (bonus): High-confidence churn rate ---
  const highConfidenceChurn = predictions.filter(
    (p) => p.label === "churn" && p.confidence >= 0.75
  );
  if (highConfidenceChurn.length > 0) {
    const pct = Math.round((highConfidenceChurn.length / total) * 100);
    insights.push({
      statement: `${pct}% of records show high-confidence churn risk (confidence ≥ 75%).`,
    });
  }

  return insights;
}
