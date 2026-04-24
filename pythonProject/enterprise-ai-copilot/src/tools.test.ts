import { describe, it, expect } from "vitest";
import { executeToolCall } from "./tools.js";
import type { UserPermissions } from "./tools.js";

const perms: UserPermissions = { userId: "u1", allowedTools: ["send_email", "write_db_record"] };

describe("executeToolCall", () => {
  it("send_email returns a result for permitted user (success depends on RESEND_API_KEY)", async () => {
    const result = await executeToolCall({ tool: "send_email", params: { to: "test@example.com", subject: "Test", body: "Hello" }, userId: "u1" }, perms);
    // Either succeeds (key set) or fails with a clear message (key not set) — both are valid
    expect(result.message.length).toBeGreaterThan(0);
    if (!process.env.RESEND_API_KEY) {
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/RESEND_API_KEY/i);
    }
  });

  it("write_db_record succeeds for permitted user", async () => {
    const result = await executeToolCall({ tool: "write_db_record", params: { content: "test record" }, userId: "u1" }, perms);
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/db\.json|postgresql/i);
  });

  it("rejects when user has no permission for tool", async () => {
    const restrictedPerms: UserPermissions = { userId: "u1", allowedTools: [] };
    const result = await executeToolCall({ tool: "send_email", params: {}, userId: "u1" }, restrictedPerms);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/permission/i);
  });

  it("rejects when userId mismatches permissions", async () => {
    const result = await executeToolCall({ tool: "send_email", params: {}, userId: "other" }, perms);
    expect(result.success).toBe(false);
  });

  it("always returns a non-empty message (Property 10)", async () => {
    const r1 = await executeToolCall({ tool: "write_db_record", params: { data: "x" }, userId: "u1" }, perms);
    const r2 = await executeToolCall({ tool: "send_email", params: {}, userId: "u1" }, { userId: "u1", allowedTools: [] });
    expect(r1.message.length).toBeGreaterThan(0);
    expect(r2.message.length).toBeGreaterThan(0);
  });
});
