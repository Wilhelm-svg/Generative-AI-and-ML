/**
 * Redis-backed job queue — replaces in-memory FIFO
 * Durable, supports multiple workers, survives restarts
 */

import { createClient } from "redis";

const QUEUE_KEY = "automation:jobs";

let client: ReturnType<typeof createClient> | null = null;

async function getClient() {
  if (!client) {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    client = createClient({ url });
    client.on("error", e => console.error("[redis-queue] Error:", e));
    await client.connect();
  }
  return client;
}

export class RedisJobQueue {
  async enqueue(job_id: string): Promise<void> {
    const redis = await getClient();
    await redis.rPush(QUEUE_KEY, job_id);
  }

  async dequeue(): Promise<string | null> {
    const redis = await getClient();
    return redis.lPop(QUEUE_KEY);
  }

  async length(): Promise<number> {
    const redis = await getClient();
    return redis.lLen(QUEUE_KEY);
  }

  async waitForItem(): Promise<void> {
    // Blocking pop with 1s timeout — efficient polling
    const redis = await getClient();
    await redis.blPop(QUEUE_KEY, 1);
  }
}

// Fallback in-memory queue for when Redis is unavailable
export class InMemoryFallbackQueue {
  private queue: string[] = [];
  private listeners: Array<() => void> = [];

  enqueue(job_id: string): void {
    this.queue.push(job_id);
    this.listeners.forEach(fn => fn());
  }

  dequeue(): string | undefined {
    return this.queue.shift();
  }

  get length(): number { return this.queue.length; }

  waitForItem(): Promise<void> {
    if (this.queue.length > 0) return Promise.resolve();
    return new Promise(resolve => {
      const listener = () => {
        this.listeners = this.listeners.filter(l => l !== listener);
        resolve();
      };
      this.listeners.push(listener);
    });
  }
}
