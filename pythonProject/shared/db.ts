/**
 * Shared PostgreSQL connection pool (pgvector-enabled)
 */

import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export interface DbPool {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): void;
  connect(): Promise<any>;
}

async function createPool(): Promise<pg.Pool> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL environment variable not set");

  const p = new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 10_000,
    // Keep connections alive to avoid "connection terminated unexpectedly"
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });
  p.on("error", (err: Error) => {
    console.error("[db] Pool error (will reconnect):", err.message);
  });
  return p;
}

export function getDb(): pg.Pool {
  if (!pool) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return pool;
}

export async function getDbAsync(): Promise<pg.Pool> {
  if (!pool) {
    pool = await createPool();
  }
  return pool;
}

export async function initDb(): Promise<void> {
  if (!pool) {
    pool = await createPool();
    // Test the connection on startup
    try {
      await pool.query("SELECT 1");
      console.log("[db] PostgreSQL connected successfully");
    } catch (e) {
      console.warn("[db] Initial connection test failed:", (e as Error).message);
      // Don't throw — pool will retry on next query
    }
  }
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Execute a function within a database transaction.
 * If the function succeeds, the transaction is committed.
 * If the function throws, the transaction is rolled back.
 */
export async function transaction<T>(
  fn: (client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }) => Promise<T>
): Promise<T> {
  const db = await getDbAsync();
  const client = await db.connect();
  
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
