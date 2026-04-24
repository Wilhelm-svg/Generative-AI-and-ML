/**
 * Shared Observability — tracks latency, tokens, cost, failures across all projects
 * Writes to PostgreSQL request_logs table
 */
export interface RequestMetrics {
    project: string;
    endpoint: string;
    userId?: string;
    latencyMs: number;
    tokensIn?: number;
    tokensOut?: number;
    model?: string;
    status: "success" | "error";
    errorMsg?: string;
}
export declare function logRequest(metrics: RequestMetrics): Promise<void>;
export declare function computeCost(model?: string, tokensIn?: number, tokensOut?: number): number;
/** Wrap an async function with automatic observability logging */
export declare function withObservability<T>(metrics: Omit<RequestMetrics, "latencyMs" | "status" | "errorMsg">, fn: () => Promise<T>): Promise<T>;
/** Get dashboard stats for a project */
export declare function getStats(project: string, hours?: number): Promise<Record<string, unknown>>;
//# sourceMappingURL=observability.d.ts.map