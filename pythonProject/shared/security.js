/**
 * Shared Security Layer
 * - Prompt injection detection
 * - Role-based access control
 * - Content moderation
 * - Rate limiting (Redis-backed sliding window)
 */
// ── Prompt Injection Detection ────────────────────────────────────────────
const INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?previous\s+instructions/i,
    /you\s+are\s+now\s+(a\s+)?(?:different|new|another)/i,
    /forget\s+(everything|all|your\s+instructions)/i,
    /system\s*:\s*you\s+are/i,
    /\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>/,
    /act\s+as\s+(?:if\s+you\s+are\s+)?(?:a\s+)?(?:jailbr(?:eak|oken)|dan|evil|unrestricted)/i,
    /disregard\s+(?:your\s+)?(?:all\s+)?(?:previous|prior|all)\s+(?:instructions|rules|guidelines)/i,
];
export function detectPromptInjection(input) {
    for (const pattern of INJECTION_PATTERNS) {
        if (pattern.test(input)) {
            return { safe: false, reason: `Potential prompt injection detected` };
        }
    }
    if (input.length > 10000) {
        return { safe: false, reason: "Input exceeds maximum length of 10,000 characters" };
    }
    return { safe: true };
}
const ROLE_PERMISSIONS = {
    admin: new Set(["chat", "ingest", "delete", "admin", "send_email", "write_db_record"]),
    user: new Set(["chat", "ingest", "send_email", "write_db_record"]),
    readonly: new Set(["chat"]),
};
export function hasPermission(role, action) {
    return ROLE_PERMISSIONS[role]?.has(action) ?? false;
}
// ── Content Moderation ────────────────────────────────────────────────────
const BLOCKED_CONTENT = [
    /\b(bomb|explosive|weapon)\s+(making|instructions|how\s+to)/i,
    /\b(hack|exploit|bypass)\s+(the\s+)?(system|database|server)/i,
];
export function moderateContent(input) {
    for (const pattern of BLOCKED_CONTENT) {
        if (pattern.test(input)) {
            return { allowed: false, reason: "Content policy violation" };
        }
    }
    return { allowed: true };
}
// ── Rate Limiting (Redis-backed sliding window) ───────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let redisClient = null;
async function getRedis() {
    if (!redisClient) {
        try {
            const url = process.env.REDIS_URL ?? "redis://localhost:6379";
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { createClient } = require("redis");
            redisClient = createClient({ url });
            redisClient.on("error", (e) => console.error("[redis] Error:", e));
            await redisClient.connect();
        }
        catch {
            redisClient = null;
            throw new Error("Redis unavailable");
        }
    }
    return redisClient;
}
export async function checkRateLimit(userId, project, limitPerMinute = 60) {
    try {
        const redis = await getRedis();
        const key = `rate:${project}:${userId}`;
        const now = Date.now();
        const windowMs = 60000;
        await redis.zRemRangeByScore(key, 0, now - windowMs);
        const count = await redis.zCard(key);
        if (count >= limitPerMinute) {
            const oldest = await redis.zRange(key, 0, 0, { REV: false });
            const resetIn = oldest.length > 0
                ? Math.ceil((parseInt(oldest[0]) + windowMs - now) / 1000)
                : 60;
            return { allowed: false, remaining: 0, resetIn };
        }
        await redis.zAdd(key, { score: now, value: `${now}-${Math.random()}` });
        await redis.expire(key, 60);
        return { allowed: true, remaining: limitPerMinute - count - 1, resetIn: 60 };
    }
    catch {
        // Fail open if Redis is down
        return { allowed: true, remaining: limitPerMinute, resetIn: 60 };
    }
}
export async function securityCheck(input, userId, project, role = "user", action = "chat") {
    const rateLimit = await checkRateLimit(userId, project);
    if (!rateLimit.allowed) {
        // Log rate limit event
        logSecurityEvent(project, "rate_limit", userId, input, `Rate limit exceeded`).catch(() => { });
        return { passed: false, reason: `Rate limit exceeded. Try again in ${rateLimit.resetIn}s`, statusCode: 429 };
    }
    if (!hasPermission(role, action)) {
        return { passed: false, reason: `Insufficient permissions for action '${action}'`, statusCode: 403 };
    }
    const injection = detectPromptInjection(input);
    if (!injection.safe) {
        // Log injection attempt
        logSecurityEvent(project, "injection_attempt", userId, input, injection.reason ?? "Injection detected", "high").catch(() => { });
        return { passed: false, reason: injection.reason, statusCode: 400 };
    }
    const moderation = moderateContent(input);
    if (!moderation.allowed) {
        logSecurityEvent(project, "abuse", userId, input, moderation.reason ?? "Content violation", "critical").catch(() => { });
        return { passed: false, reason: moderation.reason, statusCode: 400 };
    }
    return { passed: true };
}
async function logSecurityEvent(project, eventType, userId, input, reason, severity = "medium") {
    try {
        const { getDbAsync } = await import("./db.js");
        const db = await getDbAsync();
        // Hash the input for privacy
        const { createHash } = await import("crypto");
        const inputHash = createHash("sha256").update(input.slice(0, 500)).digest("hex").slice(0, 16);
        await db.query(`INSERT INTO security_events (project, event_type, user_id, input_hash, reason, severity)
       VALUES ($1, $2, $3, $4, $5, $6)`, [project, eventType, userId, inputHash, reason, severity]);
    }
    catch {
        // Never let security logging break the main flow
    }
}
//# sourceMappingURL=security.js.map