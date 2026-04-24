/**
 * PostgreSQL-backed job store — replaces InMemoryJobStore
 * Durable, scalable, survives restarts
 */

import { getDbAsync } from "../../shared/db.js";
import type { Job, PipelineType, StructuredOutput } from "./types.js";

export class PgJobStore {
  async createJob(pipeline_type: PipelineType, input_text?: string, input_json?: unknown): Promise<Job> {
    const db = await getDbAsync();
    const result = await db.query(
      `INSERT INTO jobs (pipeline_type, status, input_text, input_json)
       VALUES ($1, 'pending', $2, $3)
       RETURNING job_id, pipeline_type, status, input_text, input_json, created_at`,
      [pipeline_type, input_text ?? null, input_json ? JSON.stringify(input_json) : null]
    );
    return this.mapRow(result.rows[0]);
  }

  async getJob(job_id: string): Promise<Job | undefined> {
    const db = await getDbAsync();
    const result = await db.query(`SELECT * FROM jobs WHERE job_id = $1`, [job_id]);
    return result.rows[0] ? this.mapRow(result.rows[0]) : undefined;
  }

  async updateJob(job_id: string, updates: Partial<Pick<Job, "status" | "result" | "error">>): Promise<Job | undefined> {
    const db = await getDbAsync();
    const result = await db.query(
      `UPDATE jobs SET
         status = COALESCE($2, status),
         result = COALESCE($3::jsonb, result),
         error  = COALESCE($4, error),
         updated_at = NOW()
       WHERE job_id = $1
       RETURNING *`,
      [job_id, updates.status ?? null, updates.result ? JSON.stringify(updates.result) : null, updates.error ?? null]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : undefined;
  }

  async getPendingJobs(limit = 10): Promise<Job[]> {
    const db = await getDbAsync();
    const result = await db.query(
      `SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT $1`,
      [limit]
    );
    return result.rows.map(r => this.mapRow(r));
  }

  async getRecentJobs(limit = 20): Promise<Job[]> {
    const db = await getDbAsync();
    const result = await db.query(
      `SELECT * FROM jobs ORDER BY created_at DESC LIMIT $1`, [limit]
    );
    return result.rows.map(r => this.mapRow(r));
  }

  // No-op for compatibility
  stop(): void {}

  private mapRow(row: Record<string, unknown>): Job {
    return {
      job_id: row.job_id as string,
      pipeline_type: row.pipeline_type as PipelineType,
      status: row.status as Job["status"],
      created_at: (row.created_at as Date).toISOString(),
      input_text: row.input_text as string | undefined,
      input_json: row.input_json,
      result: row.result as StructuredOutput | undefined,
      error: row.error as string | undefined,
    };
  }
}
