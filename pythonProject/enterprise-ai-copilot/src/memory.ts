import type { UserMemory } from "./types.js";

// ─── KV Store abstraction ─────────────────────────────────────────────────────

export interface KVStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

// ─── In-memory KV (tests / no-DB fallback) ───────────────────────────────────

export class InMemoryKVStore implements KVStore {
  private store = new Map<string, string>();
  async get(key: string): Promise<string | null> { return this.store.get(key) ?? null; }
  async set(key: string, value: string): Promise<void> { this.store.set(key, value); }
  async delete(key: string): Promise<void> { this.store.delete(key); }
}

// ─── PostgreSQL-backed KV (production) ───────────────────────────────────────

export class PgKVStore implements KVStore {
  async get(key: string): Promise<string | null> {
    const { getDbAsync } = await import("../../shared/db.js");
    const db = await getDbAsync();
    const result = await db.query(
      `SELECT value FROM user_memory_kv WHERE key = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [key]
    );
    return result.rows[0]?.value as string ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    const { getDbAsync } = await import("../../shared/db.js");
    const db = await getDbAsync();
    await db.query(
      `INSERT INTO user_memory_kv (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, value]
    );
  }

  async delete(key: string): Promise<void> {
    const { getDbAsync } = await import("../../shared/db.js");
    const db = await getDbAsync();
    await db.query(`DELETE FROM user_memory_kv WHERE key = $1`, [key]);
  }
}

// ─── Factory: pick store based on environment ─────────────────────────────────

export function createKVStore(): KVStore {
  if (process.env.DATABASE_URL) {
    return new PgKVStore();
  }
  console.warn("[memory] DATABASE_URL not set — using in-memory KV store (data lost on restart).");
  return new InMemoryKVStore();
}

// ─── Memory Store ─────────────────────────────────────────────────────────────

export class MemoryStore {
  constructor(private kv: KVStore) {}

  async getMemory(userId: string): Promise<UserMemory | null> {
    const raw = await this.kv.get(`mem:${userId}`);
    if (!raw) return null;
    return JSON.parse(raw) as UserMemory;
  }

  async setMemory(userId: string, memory: UserMemory): Promise<void> {
    await this.kv.set(`mem:${userId}`, JSON.stringify(memory));
  }

  async clearMemory(userId: string): Promise<void> {
    await this.kv.delete(`mem:${userId}`);
  }

  async appendInteraction(userId: string, summary: string, maxInteractions = 10): Promise<void> {
    let memory = await this.getMemory(userId);
    // Auto-create memory record if it doesn't exist yet
    if (!memory) {
      memory = { userId, role: "user", preferences: {}, recentInteractions: [] };
    }
    const interactions = [...memory.recentInteractions, summary];
    if (interactions.length > maxInteractions) {
      interactions.splice(0, interactions.length - maxInteractions);
    }
    await this.setMemory(userId, { ...memory, recentInteractions: interactions });
  }
}
