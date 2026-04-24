import { createHmac, timingSafeEqual } from "crypto";
import type { CopilotRequest } from "./types.js";

/**
 * JWT-style token validation using HMAC-SHA256.
 * Token format: base64(userId:role:expiry):base64(hmac)
 * Falls back to accepting any non-empty token when JWT_SECRET is not set (dev mode).
 */

const JWT_SECRET = process.env.JWT_SECRET ?? "";
const DEV_MODE = !JWT_SECRET;

if (DEV_MODE) {
  console.warn("[auth] WARNING: JWT_SECRET not set — running in dev mode (any non-empty token accepted).");
}

export interface TokenPayload {
  userId: string;
  role: "admin" | "user" | "readonly";
  allowedTools: string[];
}

/**
 * Generate a signed token for a user (used by auth service / login endpoint).
 */
export function generateToken(payload: TokenPayload, expirySeconds = 3600): string {
  const expiry = Math.floor(Date.now() / 1000) + expirySeconds;
  const data = Buffer.from(JSON.stringify({ ...payload, expiry })).toString("base64url");
  const sig = createHmac("sha256", JWT_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

/**
 * Validate a token and return its payload, or null if invalid/expired.
 */
export function validateToken(token: string | undefined): TokenPayload | null {
  if (!token || typeof token !== "string" || token.length === 0) return null;

  // Dev mode: accept any non-empty token, return default payload
  if (DEV_MODE) {
    return { userId: "dev-user", role: "user", allowedTools: ["send_email", "write_db_record"] };
  }

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [data, sig] = parts;
  // Verify signature using timing-safe comparison
  const expectedSig = createHmac("sha256", JWT_SECRET).update(data).digest("base64url");
  try {
    const sigBuf = Buffer.from(sig, "base64url");
    const expectedBuf = Buffer.from(expectedSig, "base64url");
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }
  } catch {
    return null;
  }

  // Decode and check expiry
  let payload: TokenPayload & { expiry: number };
  try {
    payload = JSON.parse(Buffer.from(data, "base64url").toString("utf-8"));
  } catch {
    return null;
  }

  if (!payload.expiry || Date.now() / 1000 > payload.expiry) return null;
  if (!payload.userId || !payload.role) return null;

  return { userId: payload.userId, role: payload.role, allowedTools: payload.allowedTools ?? [] };
}

/**
 * Auth middleware: throws a 401 error if the session token is missing or invalid.
 * Attaches the decoded payload to the request for downstream use.
 */
export function authMiddleware(request: CopilotRequest): TokenPayload {
  const payload = validateToken(request.sessionToken);
  if (!payload) {
    const error = new Error("Unauthorized: invalid or missing session token") as Error & { status: number };
    error.status = 401;
    throw error;
  }
  return payload;
}
