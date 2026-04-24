/**
 * Property tests for document ingestion round-trip, tool execution, and memory
 * Properties 1, 4, 6, 7, 8, 9, 10
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { chunkText } from "./rag.js";
import { executeToolCall } from "./tools.js";
import { InMemoryKVStore, MemoryStore } from "./memory.js";
import { authMiddleware } from "./auth.js";
import type { UserPermissions } from "./tools.js";
import type { UserMemory } from "./types.js";

// ── Property 1: Document ingestion round-trip ─────────────────────────────
// For any valid text document, after chunking the chunks contain text derived from the doc

describe("Property 1: Document ingestion round-trip", () => {
  it("all chunks are substrings of the original document", () => {
    fc.assert(fc.property(
      fc.string({ minLength: 100, maxLength: 5000 }),
      (text) => {
        const chunks = chunkText(text, { strategy: "fixed", chunkSize: 512, overlap: 64 });
        if (chunks.length === 0) return text.length === 0;
        // Every chunk must be a substring of the original text
        return chunks.every(chunk => text.includes(chunk));
      }
    ), { numRuns: 200 });
  });

  it("chunking produces at least one chunk for non-empty text", () => {
    fc.assert(fc.property(
      fc.string({ minLength: 1, maxLength: 5000 }),
      (text) => {
        const chunks = chunkText(text, { strategy: "fixed", chunkSize: 512, overlap: 64 });
        return chunks.length >= 1;
      }
    ), { numRuns: 200 });
  });
});

// ── Property 4: Unauthorized tool invocations are rejected ────────────────

describe("Property 4: Unauthorized tool invocations are rejected", () => {
  it("tool call with empty allowedTools always returns success=false", async () => {
    await fc.assert(fc.asyncProperty(
      fc.constantFrom("send_email" as const, "write_db_record" as const),
      async (tool) => {
        const perms: UserPermissions = { userId: "u1", allowedTools: [] };
        const result = await executeToolCall({ tool, params: {}, userId: "u1" }, perms);
        return result.success === false;
      }
    ), { numRuns: 100 });
  });

  it("tool call with mismatched userId always returns success=false", async () => {
    await fc.assert(fc.asyncProperty(
      fc.string({ minLength: 1 }),
      fc.string({ minLength: 1 }),
      async (userId, otherUserId) => {
        if (userId === otherUserId) return true; // skip equal case
        const perms: UserPermissions = { userId, allowedTools: ["send_email", "write_db_record"] };
        const result = await executeToolCall({ tool: "send_email", params: {}, userId: otherUserId }, perms);
        return result.success === false;
      }
    ), { numRuns: 100 });
  });
});

// ── Property 9: Tool routing correctness ─────────────────────────────────

describe("Property 9: Tool routing correctness", () => {
  it("write_db_record always succeeds for permitted user and returns non-empty message", async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({ content: fc.string(), key: fc.string() }),
      async (params) => {
        const perms: UserPermissions = { userId: "u1", allowedTools: ["write_db_record"] };
        const result = await executeToolCall({ tool: "write_db_record", params, userId: "u1" }, perms);
        // Succeeds via PostgreSQL (DATABASE_URL set) or db.json fallback
        return result.success === true && result.message.length > 0;
      }
    ), { numRuns: 50 });
  });
});

// ── Property 10: Tool outcome confirmation ────────────────────────────────

describe("Property 10: Tool outcome confirmation", () => {
  it("every tool result has a non-empty message regardless of success/failure", async () => {
    await fc.assert(fc.asyncProperty(
      fc.constantFrom("send_email" as const, "write_db_record" as const),
      fc.boolean(), // whether user has permission
      async (tool, hasPermission) => {
        const perms: UserPermissions = {
          userId: "u1",
          allowedTools: hasPermission ? [tool] : [],
        };
        const result = await executeToolCall({ tool, params: { content: "test" }, userId: "u1" }, perms);
        return typeof result.message === "string" && result.message.length > 0;
      }
    ), { numRuns: 100 });
  });
});

// ── Property 6: Memory round-trip ────────────────────────────────────────

describe("Property 6: Memory round-trip", () => {
  it("any written memory can be read back unchanged", async () => {
    await fc.assert(fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 50 }),
      fc.string({ minLength: 1, maxLength: 20 }),
      async (userId, role) => {
        const store = new MemoryStore(new InMemoryKVStore());
        const mem: UserMemory = { userId, role, preferences: {}, recentInteractions: [] };
        await store.setMemory(userId, mem);
        const retrieved = await store.getMemory(userId);
        return JSON.stringify(retrieved) === JSON.stringify(mem);
      }
    ), { numRuns: 200 });
  });
});

// ── Property 7: Memory included in prompt ────────────────────────────────

describe("Property 7: Memory included in prompt", () => {
  it("user memory role is preserved after multiple interactions", async () => {
    await fc.assert(fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 5 }),
      async (role, interactions) => {
        const store = new MemoryStore(new InMemoryKVStore());
        const userId = "test-user";
        await store.setMemory(userId, { userId, role, preferences: {}, recentInteractions: [] });
        for (const interaction of interactions) {
          await store.appendInteraction(userId, interaction);
        }
        const mem = await store.getMemory(userId);
        return mem?.role === role && mem.recentInteractions.length > 0;
      }
    ), { numRuns: 100 });
  });
});

// ── Property 8: Memory clear completeness ────────────────────────────────

describe("Property 8: Memory clear completeness", () => {
  it("after clearMemory, getMemory always returns null", async () => {
    await fc.assert(fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 50 }),
      async (userId) => {
        const store = new MemoryStore(new InMemoryKVStore());
        await store.setMemory(userId, { userId, role: "user", preferences: {}, recentInteractions: [] });
        await store.clearMemory(userId);
        return (await store.getMemory(userId)) === null;
      }
    ), { numRuns: 200 });
  });
});

// ── Task 8.2: End-to-end integration tests ───────────────────────────────

describe("End-to-end integration: auth + tools + memory", () => {
  it("auth rejection: empty token returns 401 error", () => {
    const req = { userId: "u1", sessionToken: "", message: "test" };
    let status = 0;
    try { authMiddleware(req); }
    catch (e: unknown) { status = (e as { status: number }).status; }
    expect(status).toBe(401);
  });

  it("tool invocation: write_db_record persists data", async () => {
    const perms: UserPermissions = { userId: "u1", allowedTools: ["write_db_record"] };
    const result = await executeToolCall(
      { tool: "write_db_record", params: { key: "test", value: "integration-test" }, userId: "u1" },
      perms
    );
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/db\.json|postgresql/i);
  });

  it("memory: set → get → append → clear lifecycle", async () => {
    const store = new MemoryStore(new InMemoryKVStore());
    await store.setMemory("u1", { userId: "u1", role: "admin", preferences: { theme: "dark" }, recentInteractions: [] });
    const mem1 = await store.getMemory("u1");
    expect(mem1?.role).toBe("admin");

    await store.appendInteraction("u1", "first query");
    const mem2 = await store.getMemory("u1");
    expect(mem2?.recentInteractions).toContain("first query");

    await store.clearMemory("u1");
    expect(await store.getMemory("u1")).toBeNull();
  });
});
