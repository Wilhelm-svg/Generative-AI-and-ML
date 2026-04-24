/**
 * Shared Security Layer
 * - Prompt injection detection
 * - Role-based access control
 * - Content moderation
 * - Rate limiting (Redis-backed sliding window)
 */
export declare function detectPromptInjection(input: string): {
    safe: boolean;
    reason?: string;
};
export type Role = "admin" | "user" | "readonly";
export declare function hasPermission(role: Role, action: string): boolean;
export declare function moderateContent(input: string): {
    allowed: boolean;
    reason?: string;
};
export declare function checkRateLimit(userId: string, project: string, limitPerMinute?: number): Promise<{
    allowed: boolean;
    remaining: number;
    resetIn: number;
}>;
export interface SecurityCheckResult {
    passed: boolean;
    reason?: string;
    statusCode?: number;
}
export declare function securityCheck(input: string, userId: string, project: string, role?: Role, action?: string): Promise<SecurityCheckResult>;
//# sourceMappingURL=security.d.ts.map