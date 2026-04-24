/**
 * Production RAG: pgvector-backed vector store with hybrid search + reranking
 * Replaces in-memory array
 */

import { getDbAsync } from "../../shared/db.js";
import type { Chunk, IngestRequest } from "./types.js";
import { groqEmbed } from "./groq.js";
import { randomUUID } from "crypto";

// ── Chunking strategies ───────────────────────────────────────────────────

export interface ChunkOptions {
  strategy: "fixed" | "sentence" | "paragraph";
  chunkSize: number;
  overlap: number;
}

export function chunkText(text: string, opts: ChunkOptions = { strategy: "fixed", chunkSize: 512, overlap: 64 }): string[] {
  if (!text?.trim()) return [];

  if (opts.strategy === "paragraph") {
    return text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 50);
  }

  if (opts.strategy === "sentence") {
    const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
    const chunks: string[] = [];
    let current = "";
    for (const s of sentences) {
      if ((current + s).length > opts.chunkSize && current) {
        chunks.push(current.trim());
        current = s;
      } else {
        current += " " + s;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }

  // Fixed size with overlap
  const chunks: string[] = [];
  const step = opts.chunkSize - opts.overlap;
  for (let i = 0; i < text.length; i += step) {
    chunks.push(text.slice(i, i + opts.chunkSize));
    if (i + opts.chunkSize >= text.length) break;
  }
  return chunks;
}

// ── pgvector store ────────────────────────────────────────────────────────

export async function ingestToDB(
  req: IngestRequest,
  embedFn: (text: string) => Promise<number[]>,
  opts?: ChunkOptions
): Promise<{ documentId: string; chunksCreated: number }> {
  const db = await getDbAsync();
  const ext = req.fileName.split(".").pop()?.toLowerCase();

  let text: string;
  if (ext === "txt") {
    text = req.fileBuffer.toString("utf-8");
  } else if (ext === "pdf") {
    const pdfParse = (await import("pdf-parse")).default;
    const result = await pdfParse(req.fileBuffer);
    text = result.text;
  } else {
    throw new Error(`Unsupported format: ${ext}. Use PDF or TXT.`);
  }

  if (!text?.trim()) throw new Error(`Document "${req.fileName}" contains no extractable text.`);

  // Store document
  const docResult = await db.query(
    `INSERT INTO documents (name, content, permissions) VALUES ($1,$2,$3) RETURNING id`,
    [req.fileName, text.slice(0, 10000), req.permissions]
  );
  const documentId = docResult.rows[0].id as string;

  // Chunk and embed
  const chunks = chunkText(text, opts);
  let chunksCreated = 0;

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embedFn(chunks[i]);
    const vectorStr = `[${embedding.join(",")}]`;
    await db.query(
      `INSERT INTO document_chunks (id, document_id, doc_name, chunk_text, chunk_index, embedding, permissions)
       VALUES ($1,$2,$3,$4,$5,$6::vector,$7)`,
      [randomUUID(), documentId, req.fileName, chunks[i], i, vectorStr, req.permissions]
    );
    chunksCreated++;
  }
  return { documentId, chunksCreated };
}

// ── Hybrid retrieval: vector + keyword + reranking ────────────────────────

export async function hybridRetrieve(
  query: string,
  userId: string,
  embedFn: (text: string) => Promise<number[]>,
  topK = 5,
  metadataFilter?: Record<string, unknown>
): Promise<Chunk[]> {
  const db = await getDbAsync();
  const queryEmbedding = await embedFn(query);
  const vectorStr = `[${queryEmbedding.join(",")}]`;

  // Vector similarity search with permission filtering
  const vectorResult = await db.query(
    `SELECT id, doc_name, chunk_text, permissions,
            1 - (embedding <=> $1::vector) AS similarity
     FROM document_chunks
     WHERE $2 = ANY(permissions)
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [vectorStr, userId, topK * 2]
  );

  // Keyword search (BM25-style using PostgreSQL full-text)
  const keywordResult = await db.query(
    `SELECT id, doc_name, chunk_text, permissions,
            ts_rank(to_tsvector('english', chunk_text), plainto_tsquery('english', $1)) AS rank
     FROM document_chunks
     WHERE $2 = ANY(permissions)
       AND to_tsvector('english', chunk_text) @@ plainto_tsquery('english', $1)
     ORDER BY rank DESC
     LIMIT $3`,
    [query, userId, topK * 2]
  );

  // Merge and deduplicate (Reciprocal Rank Fusion)
  const scores = new Map<string, { chunk: Record<string, unknown>; score: number }>();

  vectorResult.rows.forEach((row, i) => {
    scores.set(row.id as string, { chunk: row, score: 1 / (60 + i + 1) });
  });

  keywordResult.rows.forEach((row, i) => {
    const id = row.id as string;
    const existing = scores.get(id);
    if (existing) {
      existing.score += 1 / (60 + i + 1);
    } else {
      scores.set(id, { chunk: row, score: 1 / (60 + i + 1) });
    }
  });

  // Sort by RRF score and return top K
  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ chunk }) => ({
      id: chunk.id as string,
      documentName: chunk.doc_name as string,
      text: chunk.chunk_text as string,
      embedding: [] as number[],
      permissions: chunk.permissions as string[],
    }));
}

// ── Persistent memory (PostgreSQL) ───────────────────────────────────────

export async function getMemoryFromDB(userId: string) {
  const db = await getDbAsync();
  const result = await db.query(
    `SELECT role, preferences, recent_interactions FROM user_memory WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0] ?? null;
}

export async function upsertMemoryToDB(
  userId: string,
  role: string,
  preferences: Record<string, string>,
  recentInteractions: string[]
): Promise<void> {
  const db = await getDbAsync();
  await db.query(
    `INSERT INTO user_memory (user_id, role, preferences, recent_interactions, updated_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       role = EXCLUDED.role,
       preferences = EXCLUDED.preferences,
       recent_interactions = EXCLUDED.recent_interactions,
       updated_at = NOW()`,
    [userId, role, JSON.stringify(preferences), recentInteractions]
  );
}

export async function clearMemoryFromDB(userId: string): Promise<void> {
  const db = await getDbAsync();
  await db.query(`DELETE FROM user_memory WHERE user_id = $1`, [userId]);
}
