import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { chunkText, cosineSimilarity, retrieveChunks } from "./rag.js";
import type { Chunk } from "./types.js";

describe("chunkText", () => {
  it("returns empty array for empty string", () => expect(chunkText("")).toHaveLength(0));
  it("returns one chunk for short text", () => expect(chunkText("hello world")).toHaveLength(1));
  it("chunks long text into multiple pieces", () => {
    const text = "a".repeat(2000);
    const chunks = chunkText(text, { strategy: "fixed", chunkSize: 512, overlap: 64 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach(c => expect(c.length).toBeLessThanOrEqual(512));
  });
  it("each chunk is a substring of the original", () => {
    const text = "The quick brown fox jumps over the lazy dog. ".repeat(50);
    chunkText(text, { strategy: "fixed", chunkSize: 100, overlap: 20 }).forEach(c => expect(text).toContain(c));
  });
});

describe("cosineSimilarity", () => {
  it("identical vectors → 1", () => expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1));
  it("orthogonal vectors → 0", () => expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0));
  it("zero vector → 0", () => expect(cosineSimilarity([0, 0], [1, 1])).toBe(0));
});

describe("retrieveChunks", () => {
  const embedFn = async (text: string) => [text.length, text.charCodeAt(0) || 0];

  const makeChunk = (id: string, text: string, permissions: string[]): Chunk => ({
    id, documentName: "doc.txt", text, embedding: [text.length, text.charCodeAt(0) || 0], permissions,
  });

  it("returns empty array when no chunks permitted", async () => {
    const chunks = [makeChunk("1", "hello", ["other-user"])];
    const result = await retrieveChunks("hello", "user1", chunks, embedFn);
    expect(result).toHaveLength(0);
  });

  it("returns only permitted chunks", async () => {
    const chunks = [
      makeChunk("1", "hello", ["user1"]),
      makeChunk("2", "world", ["user2"]),
    ];
    const result = await retrieveChunks("hello", "user1", chunks, embedFn);
    expect(result.every(c => c.permissions.includes("user1"))).toBe(true);
  });

  it("returns at most topK chunks", async () => {
    const chunks = Array.from({ length: 10 }, (_, i) =>
      makeChunk(String(i), `text ${i}`, ["user1"])
    );
    const result = await retrieveChunks("text", "user1", chunks, embedFn, 5);
    expect(result.length).toBeLessThanOrEqual(5);
  });
});

// Property 2: Retrieval count invariant
describe("Property 2: Retrieval count invariant", () => {
  it("retrieved chunks never exceed topK=5", async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 20 }),
      async (texts) => {
        const embedFn = async (t: string) => [t.length];
        const chunks: Chunk[] = texts.map((t, i) => ({
          id: String(i), documentName: "d", text: t,
          embedding: [t.length], permissions: ["u1"],
        }));
        const result = await retrieveChunks("query", "u1", chunks, embedFn, 5);
        return result.length <= 5;
      }
    ), { numRuns: 100 });
  });
});

// Property 3: Permission filtering
describe("Property 3: Permission filtering", () => {
  it("all returned chunks are permitted for the requesting user", async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.boolean(), { minLength: 0, maxLength: 20 }),
      async (permitted) => {
        const embedFn = async (t: string) => [t.length];
        const chunks: Chunk[] = permitted.map((p, i) => ({
          id: String(i), documentName: "d", text: `text${i}`,
          embedding: [5], permissions: p ? ["u1"] : ["other"],
        }));
        const result = await retrieveChunks("query", "u1", chunks, embedFn, 5);
        return result.every(c => c.permissions.includes("u1"));
      }
    ), { numRuns: 100 });
  });
});
