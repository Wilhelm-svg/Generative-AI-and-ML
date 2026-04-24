import { v4 as uuidv4 } from "uuid";
import type { Job, JobStatus, PipelineType, StructuredOutput } from "./types.js";

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class InMemoryJobStore {
  private jobs = new Map<string, Job>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    // Run TTL cleanup every hour
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 60 * 1000);
    // Allow process to exit even if interval is active
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  createJob(pipeline_type: PipelineType, input_text?: string, input_json?: unknown): Job {
    const job: Job = {
      job_id: uuidv4(),
      pipeline_type,
      status: "pending",
      created_at: new Date().toISOString(),
      input_text,
      input_json,
    };
    this.jobs.set(job.job_id, job);
    return job;
  }

  getJob(job_id: string): Job | undefined {
    return this.jobs.get(job_id);
  }

  updateJob(
    job_id: string,
    updates: Partial<Pick<Job, "status" | "result" | "error">>
  ): Job | undefined {
    const job = this.jobs.get(job_id);
    if (!job) return undefined;
    const updated: Job = { ...job, ...updates };
    this.jobs.set(job_id, updated);
    return updated;
  }

  /** Remove completed/failed jobs older than 24 hours */
  private cleanup(): void {
    const cutoff = Date.now() - TTL_MS;
    for (const [id, job] of this.jobs) {
      if (
        (job.status === "completed" || job.status === "failed") &&
        new Date(job.created_at).getTime() < cutoff
      ) {
        this.jobs.delete(id);
      }
    }
  }

  /** Expose for testing */
  get size(): number {
    return this.jobs.size;
  }

  stop(): void {
    clearInterval(this.cleanupInterval);
  }
}
