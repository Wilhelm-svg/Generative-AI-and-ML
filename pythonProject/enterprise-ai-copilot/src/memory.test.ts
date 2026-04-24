import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { InMemoryKVStore, MemoryStore } from "./memory.js";
import type { UserMemory } from "./types.js";

const makeMemory = (userId = "u1"): UserMemory => ({
  userId, role: "admin", preferences: { theme: "dark" }, recentInteractions: [],
});

describe("InMemoryKVStore", () => {
  it("get returns null for missing key", async () => {
    const kv = new InMemoryKVStore();
    expect(await kv.get("missing")).toBeNull();
  });
  it("set and get round-trip", async () => {
    const kv = new InMemoryKVStore();
    await kv.set("k", "v");
    expect(await kv.get("k")).toBe("v");
  });
  it("delete removes key", async () => {
    const kv = new InMemoryKVStore();
    await kv.set("k", "v");
    await kv.delete("k");
    expect(await kv.get("k")).toBeNull();
  });
});

describe("MemoryStore", () => {
  it("getMemory returns null for unknown user", async () => {
    const store = new MemoryStore(new InMemoryKVStore());
    expect(await store.getMemory("nobody")).toBeNull();
  });

  it("setMemory and getMemory round-trip", async () => {
    const store = new MemoryStore(new InMemoryKVStore());
    const mem = makeMemory();
    await store.setMemory("u1", mem);
    expect(await store.getMemory("u1")).toEqual(mem);
  });

  it("clearMemory removes user context", async () => {
    const store = new MemoryStore(new InMemoryKVStore());
    await store.setMemory("u1", makeMemory());
    await store.clearMemory("u1");
    expect(await store.getMemory("u1")).toBeNull();
  });

  it("appendInteraction adds to recentInteractions", async () => {
    const store = new MemoryStore(new InMemoryKVStore());
    await store.setMemory("u1", makeMemory());
    await store.appendInteraction("u1", "first query");
    const mem = await store.getMemory("u1");
    expect(mem?.recentInteractions).toContain("first query");
  });

  it("appendInteraction trims to maxInteractions", async () => {
    const store = new MemoryStore(new InMemoryKVStore());
    await store.setMemory("u1", makeMemory());
    for (let i = 0; i < 15; i++) await store.appendInteraction("u1", `query ${i}`, 10);
    const mem = await store.getMemory("u1");
    expect(mem?.recentInteractions.length).toBeLessThanOrEqual(10);
  });
});

// Property 6: Memory round-trip
describe("Property 6: Memory round-trip", () => {
  it("any written memory can be read back unchanged", async () => {
    await fc.assert(fc.asyncProperty(
      fc.string({ minLength: 1 }), fc.string({ minLength: 1 }),
      async (userId, role) => {
        const store = new MemoryStore(new InMemoryKVStore());
        const mem: UserMemory = { userId, role, preferences: {}, recentInteractions: [] };
        await store.setMemory(userId, mem);
        const retrieved = await store.getMemory(userId);
        return JSON.stringify(retrieved) === JSON.stringify(mem);
      }
    ), { numRuns: 100 });
  });
});

// Property 8: Memory clear completeness
describe("Property 8: Memory clear completeness", () => {
  it("after clearMemory, getMemory always returns null", async () => {
    await fc.assert(fc.asyncProperty(
      fc.string({ minLength: 1 }),
      async (userId) => {
        const store = new MemoryStore(new InMemoryKVStore());
        await store.setMemory(userId, makeMemory(userId));
        await store.clearMemory(userId);
        return (await store.getMemory(userId)) === null;
      }
    ), { numRuns: 100 });
  });
});
