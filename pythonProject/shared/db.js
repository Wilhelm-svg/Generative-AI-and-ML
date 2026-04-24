/**
 * Shared PostgreSQL connection pool (pgvector-enabled)
 * Uses indirect dynamic import so TypeScript doesn't resolve 'pg' types
 * from shared/node_modules — each project provides pg in its own node_modules.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pool = null;
async function createPool() {
    const url = process.env.DATABASE_URL;
    if (!url)
        throw new Error("DATABASE_URL environment variable not set");
    // Indirect dynamic import — avoids TypeScript resolving 'pg' from shared/
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const pg = await (new Function('m', 'return import(m)'))('pg');
    const Pool = pg.default?.Pool ?? pg.Pool;
    const p = new Pool({
        connectionString: url,
        max: 10,
        idleTimeoutMillis: 60000,
        connectionTimeoutMillis: 10000,
        // Keep connections alive to avoid "connection terminated unexpectedly"
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
    });
    p.on("error", (err) => {
        console.error("[db] Pool error (will reconnect):", err.message);
    });
    return p;
}
export function getDb() {
    if (!pool) {
        throw new Error("Database not initialized. Call initDb() first.");
    }
    return pool;
}
export async function getDbAsync() {
    if (!pool) {
        pool = await createPool();
    }
    return pool;
}
export async function initDb() {
    if (!pool) {
        pool = await createPool();
        // Test the connection on startup
        try {
            await pool.query("SELECT 1");
            console.log("[db] PostgreSQL connected successfully");
        }
        catch (e) {
            console.warn("[db] Initial connection test failed:", e.message);
            // Don't throw — pool will retry on next query
        }
    }
}
export async function closeDb() {
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
export async function transaction(fn) {
    const db = await getDbAsync();
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=db.js.map