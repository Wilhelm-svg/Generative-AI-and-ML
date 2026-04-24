import { InvoiceExtractor, EmailClassifier, TicketCategorizer } from "./extractors.js";
import type { RedisJobQueue, InMemoryFallbackQueue } from "./redisQueue.js";
import type { PgJobStore } from "./pgJobStore.js";
import type { InMemoryJobStore } from "./jobStore.js";

const TIMEOUT_MS = 30_000;

type AnyStore = PgJobStore | InMemoryJobStore;
type AnyQueue = RedisJobQueue | InMemoryFallbackQueue;

export class Processor {
  private running = false;
  private invoiceExtractor = new InvoiceExtractor();
  private emailClassifier = new EmailClassifier();
  private ticketCategorizer = new TicketCategorizer();

  constructor(private store: AnyStore, private queue: AnyQueue) {}

  start(): void {
    this.running = true;
    this.loop().catch(e => console.error("[processor] Loop crashed:", e));
  }

  stop(): void {
    this.running = false;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        // For Redis: blPop returns the item directly; for in-memory: poll via waitForItem then dequeue
        let job_id: string | null = null;

        if ("blPop" in (this.queue as unknown as Record<string, unknown>) || typeof (this.queue as RedisJobQueue).dequeue === "function") {
          // Redis queue: use dequeue (lPop) directly with a polling loop
          job_id = await (this.queue as RedisJobQueue).dequeue() ?? null;
          if (!job_id) {
            // Nothing in queue, wait 500ms before polling again
            await new Promise(r => setTimeout(r, 500));
            continue;
          }
        } else {
          // In-memory queue
          const memQueue = this.queue as InMemoryFallbackQueue;
          await memQueue.waitForItem();
          job_id = memQueue.dequeue() ?? null;
        }

        if (job_id) {
          await this.processJob(job_id);
        }
      } catch (e) {
        console.error("[processor] Error in loop:", e);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  async processJob(job_id: string): Promise<void> {
    const job = await (this.store as PgJobStore).getJob(job_id);
    if (!job) return;

    await (this.store as PgJobStore).updateJob(job_id, { status: "processing" });

    try {
      const result = await Promise.race([
        this.runExtractor(job_id),
        this.timeout(),
      ]);
      await (this.store as PgJobStore).updateJob(job_id, { status: "completed", result });
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : "Unknown processing error";
      await (this.store as PgJobStore).updateJob(job_id, { status: "failed", error: reason });
    }
  }

  private async runExtractor(job_id: string) {
    const job = await (this.store as PgJobStore).getJob(job_id);
    if (!job) throw new Error(`Job ${job_id} not found`);
    const input = { input_text: job.input_text, input_json: job.input_json };

    switch (job.pipeline_type) {
      case "invoice_extraction":
        return this.invoiceExtractor.extract(input);
      case "email_classification":
        return this.emailClassifier.classify(input);
      case "support_ticket_categorization":
        return this.ticketCategorizer.categorize(input);
      default:
        throw new Error(`Unsupported pipeline type: ${job.pipeline_type}`);
    }
  }

  private timeout(): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error("processing timeout")), TIMEOUT_MS)
    );
  }
}

// Keep JobQueue export for backward compat with tests
export class JobQueue {
  private queue: string[] = [];
  private listeners: Array<() => void> = [];
  enqueue(job_id: string): void { this.queue.push(job_id); this.listeners.forEach(fn => fn()); }
  dequeue(): string | undefined { return this.queue.shift(); }
  get length(): number { return this.queue.length; }
  waitForItem(): Promise<void> {
    if (this.queue.length > 0) return Promise.resolve();
    return new Promise(resolve => {
      const listener = () => { this.listeners = this.listeners.filter(l => l !== listener); resolve(); };
      this.listeners.push(listener);
    });
  }
}
