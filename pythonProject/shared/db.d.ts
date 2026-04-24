/**
 * Shared PostgreSQL connection pool (pgvector-enabled)
 * Uses indirect dynamic import so TypeScript doesn't resolve 'pg' types
 * from shared/node_modules — each project provides pg in its own node_modules.
 */
export interface DbPool {
    query(text: string, values?: unknown[]): Promise<{
        rows: Record<string, unknown>[];
    }>;
    end(): Promise<void>;
    on(event: string, listener: (...args: any[]) => void): void;
    connect(): Promise<any>;
}
export declare function getDb(): DbPool;
export declare function getDbAsync(): Promise<DbPool>;
export declare function initDb(): Promise<void>;
export declare function closeDb(): Promise<void>;
/**
 * Execute a function within a database transaction.
 * If the function succeeds, the transaction is committed.
 * If the function throws, the transaction is rolled back.
 */
export declare function transaction<T>(fn: (client: {
    query: (text: string, values?: unknown[]) => Promise<{
        rows: Record<string, unknown>[];
    }>;
}) => Promise<T>): Promise<T>;
//# sourceMappingURL=db.d.ts.map