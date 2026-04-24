/**
 * PostgreSQL-backed prediction store — replaces InMemoryPredictionStore
 */

import { getDbAsync } from "../../shared/db.js";
import type { StoredPrediction } from "./types.js";

export class PgPredictionStore {
  async add(prediction: StoredPrediction): Promise<void> {
    const db = await getDbAsync();
    await db.query(
      `INSERT INTO predictions (id, input_fields, label, confidence, explanation, recommendation, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO NOTHING`,
      [
        prediction.id,
        JSON.stringify(prediction.input),
        prediction.label,
        prediction.confidence,
        JSON.stringify(prediction.explanation),
        prediction.recommendation,
        prediction.timestamp,
      ]
    );
  }

  async getAll(): Promise<StoredPrediction[]> {
    const db = await getDbAsync();
    const result = await db.query(`SELECT * FROM predictions ORDER BY created_at DESC`);
    return result.rows.map(this.mapRow);
  }

  async getById(id: string): Promise<StoredPrediction | undefined> {
    const db = await getDbAsync();
    const result = await db.query(`SELECT * FROM predictions WHERE id = $1`, [id]);
    return result.rows[0] ? this.mapRow(result.rows[0]) : undefined;
  }

  async getByLabel(label: string): Promise<StoredPrediction[]> {
    const db = await getDbAsync();
    const result = await db.query(
      `SELECT * FROM predictions WHERE label = $1 ORDER BY created_at DESC`, [label]
    );
    return result.rows.map(this.mapRow);
  }

  async getLabelDistribution(): Promise<Record<string, number>> {
    const db = await getDbAsync();
    const result = await db.query(
      `SELECT label, COUNT(*)::int AS count FROM predictions GROUP BY label`
    );
    return Object.fromEntries(result.rows.map(r => [r.label, r.count]));
  }

  async getStats() {
    const db = await getDbAsync();
    const result = await db.query(`
      SELECT
        COUNT(*)::int AS total,
        AVG(confidence)::numeric(4,3) AS avg_confidence,
        COUNT(*) FILTER (WHERE label = 'churn')::int AS churn_count,
        COUNT(*) FILTER (WHERE label = 'no-churn')::int AS no_churn_count,
        ROUND(100.0 * COUNT(*) FILTER (WHERE label = 'churn') / NULLIF(COUNT(*),0), 1) AS churn_rate_pct
      FROM predictions
    `);
    return result.rows[0];
  }

  private mapRow(row: Record<string, unknown>): StoredPrediction {
    return {
      id: row.id as string,
      timestamp: (row.created_at as Date).toISOString(),
      input: row.input_fields as Record<string, unknown>,
      label: row.label as string,
      confidence: parseFloat(row.confidence as string),
      explanation: row.explanation as StoredPrediction["explanation"],
      recommendation: row.recommendation as string,
    };
  }
}
