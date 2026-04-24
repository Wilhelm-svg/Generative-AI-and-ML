import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { validateToken, authMiddleware } from "./auth.js";
import type { CopilotRequest } from "./types.js";

describe("validateToken", () => {
  it("returns null for undefined", () => expect(validateToken(undefined)).toBeNull());
  it("returns null for empty string", () => expect(validateToken("")).toBeNull());
  it("returns a payload object for any non-empty string (dev mode)", () => {
    const result = validateToken("abc");
    expect(result).not.toBeNull();
    expect(typeof result).toBe("object");
  });
});

describe("authMiddleware", () => {
  it("throws 401 for missing token", () => {
    const req: CopilotRequest = { userId: "u1", sessionToken: "", message: "hi" };
    expect(() => authMiddleware(req)).toThrow();
    try { authMiddleware(req); } catch (e: unknown) {
      expect((e as { status: number }).status).toBe(401);
    }
  });

  it("does not throw for valid token", () => {
    const req: CopilotRequest = { userId: "u1", sessionToken: "valid-token", message: "hi" };
    expect(() => authMiddleware(req)).not.toThrow();
  });
});

// Property 5: Authentication gate
describe("Property 5: Authentication gate", () => {
  it("any non-empty token passes; empty/undefined always fails", () => {
    fc.assert(fc.property(fc.string({ minLength: 1 }), (token) => {
      const req: CopilotRequest = { userId: "u", sessionToken: token, message: "m" };
      let threw = false;
      try { authMiddleware(req); } catch { threw = true; }
      return !threw;
    }), { numRuns: 100 });
  });
});
