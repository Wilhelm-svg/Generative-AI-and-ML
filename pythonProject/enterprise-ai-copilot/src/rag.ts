import { randomUUID } from "crypto";
import type { IngestRequest, Chunk } from "./types.js";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface VectorDB {
  upsert(chunk: Chunk): Promise<void>;
}

export type EmbedFn = (text: string) => Promise<number[]>;

// ─── Text Chunking ────────────────────────────────────────────────────────────

export type ChunkStrategy = "fixed" | "sentence" | "paragraph";

export interface ChunkOptions {
  strategy?: ChunkStrategy;
  chunkSize?: number;
  overlap?: number;
}

/**
 * Fixed-size chunking with overlap
 */
function chunkFixed(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  const step = chunkSize - overlap;
  let start = 0;

  while (start < text.length) {
    chunks.push(text.slice(start, start + chunkSize));
    if (start + chunkSize >= text.length) break;
    start += step;
  }

  return chunks;
}

/**
 * Sentence-based chunking - splits on sentence boundaries
 */
function chunkSentence(text: string, chunkSize: number, overlap: number): string[] {
  // Split on sentence boundaries (., !, ?)
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks: string[] = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length <= chunkSize) {
      currentChunk += sentence;
    } else {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = sentence;
    }
  }
  
  if (currentChunk) chunks.push(currentChunk.trim());

  // Apply overlap by including last N chars from previous chunk
  if (overlap > 0 && chunks.length > 1) {
    for (let i = 1; i < chunks.length; i++) {
      const prevChunk = chunks[i - 1];
      const overlapText = prevChunk.slice(-overlap);
      chunks[i] = overlapText + " " + chunks[i];
    }
  }

  return chunks.filter(c => c.length > 0);
}

/**
 * Paragraph-based chunking - splits on paragraph boundaries
 */
function chunkParagraph(text: string, chunkSize: number, overlap: number): string[] {
  // Split on double newlines or multiple spaces
  const paragraphs = text.split(/\n\n+|\r\n\r\n+/).filter(p => p.trim().length > 0);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    if ((currentChunk + paragraph).length <= chunkSize) {
      currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
    } else {
      if (currentChunk) chunks.push(currentChunk.trim());
      // If single paragraph exceeds chunkSize, split it with fixed chunking
      if (paragraph.length > chunkSize) {
        chunks.push(...chunkFixed(paragraph, chunkSize, overlap));
        currentChunk = "";
      } else {
        currentChunk = paragraph;
      }
    }
  }
  
  if (currentChunk) chunks.push(currentChunk.trim());

  // Apply overlap
  if (overlap > 0 && chunks.length > 1) {
    for (let i = 1; i < chunks.length; i++) {
      const prevChunk = chunks[i - 1];
      const overlapText = prevChunk.slice(-overlap);
      chunks[i] = overlapText + " " + chunks[i];
    }
  }

  return chunks.filter(c => c.length > 0);
}

/**
 * Main chunking function with strategy selection
 */
export function chunkText(
  text: string,
  options: ChunkOptions = {}
): string[] {
  if (!text || text.length === 0) return [];

  const { strategy = "fixed", chunkSize = 512, overlap = 64 } = options;

  switch (strategy) {
    case "sentence":
      return chunkSentence(text, chunkSize, overlap);
    case "paragraph":
      return chunkParagraph(text, chunkSize, overlap);
    case "fixed":
    default:
      return chunkFixed(text, chunkSize, overlap);
  }
}

// ─── Document Ingestion ───────────────────────────────────────────────────────

export async function ingestDocument(
  req: IngestRequest,
  vectorDB: VectorDB,
  embedFn: EmbedFn,
  chunkOptions?: ChunkOptions
): Promise<void> {
  const ext = req.fileName.split(".").pop()?.toLowerCase();

  let text: string;

  if (ext === "txt") {
    text = req.fileBuffer.toString("utf-8");
  } else if (ext === "pdf") {
    // Dynamic import to support ESM
    const pdfParse = (await import("pdf-parse")).default;
    const result = await pdfParse(req.fileBuffer).catch((err: unknown) => {
      throw new Error(
        `Failed to parse PDF "${req.fileName}": ${err instanceof Error ? err.message : String(err)}`
      );
    });
    text = result.text;
  } else {
    throw new Error(
      `Unsupported file format "${ext ?? "unknown"}". Only PDF and TXT files are supported.`
    );
  }

  if (!text || text.trim().length === 0) {
    throw new Error(`Document "${req.fileName}" contains no extractable text.`);
  }

  const chunks = chunkText(text, chunkOptions);
  const documentName = req.fileName;

  for (const chunkText_ of chunks) {
    const embedding = await embedFn(chunkText_);
    const chunk: Chunk = {
      id: randomUUID(),
      documentName,
      text: chunkText_,
      embedding,
      permissions: req.permissions,
    };
    await vectorDB.upsert(chunk);
  }
}

// ─── Retrieval with Permission Filtering ─────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * BM25 scoring for text relevance
 * k1 = term frequency saturation parameter (default 1.5)
 * b = length normalization parameter (default 0.75)
 */
export function bm25Score(
  query: string,
  document: string,
  allDocuments: string[],
  k1 = 1.5,
  b = 0.75
): number {
  const queryTerms = query.toLowerCase().split(/\s+/);
  const docTerms = document.toLowerCase().split(/\s+/);
  const docLength = docTerms.length;
  
  // Calculate average document length
  const avgDocLength = allDocuments.reduce((sum, doc) => 
    sum + doc.split(/\s+/).length, 0) / allDocuments.length;
  
  let score = 0;
  
  for (const term of queryTerms) {
    // Term frequency in document
    const tf = docTerms.filter(t => t === term).length;
    
    // Document frequency (how many documents contain this term)
    const df = allDocuments.filter(doc => 
      doc.toLowerCase().includes(term)).length;
    
    // Inverse document frequency
    const idf = Math.log((allDocuments.length - df + 0.5) / (df + 0.5) + 1);
    
    // BM25 formula
    const numerator = tf * (k1 + 1);
    const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLength));
    
    score += idf * (numerator / denominator);
  }
  
  return score;
}

/**
 * Reciprocal Rank Fusion (RRF) - combines multiple ranking lists
 * k = constant to prevent high ranks from dominating (default 60)
 */
export function reciprocalRankFusion(
  rankings: Array<Array<{ id: string; score: number }>>,
  k = 60
): Array<{ id: string; score: number }> {
  const rrfScores = new Map<string, number>();
  
  for (const ranking of rankings) {
    ranking.forEach((item, rank) => {
      const currentScore = rrfScores.get(item.id) || 0;
      rrfScores.set(item.id, currentScore + 1 / (k + rank + 1));
    });
  }
  
  return Array.from(rrfScores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Hybrid retrieval with cosine similarity + BM25 + RRF reranking
 */
export async function retrieveChunks(
  query: string,
  userId: string,
  allChunks: Chunk[],
  embedFn: EmbedFn,
  topK = 5
): Promise<Chunk[]> {
  const permitted = allChunks.filter(c => c.permissions.includes(userId));
  if (permitted.length === 0) return [];

  const queryEmbedding = await embedFn(query);
  const allDocTexts = permitted.map(c => c.text);

  // Ranking 1: Cosine similarity (vector search)
  const vectorRanking = permitted
    .map(c => ({ 
      id: c.id, 
      score: cosineSimilarity(queryEmbedding, c.embedding),
      chunk: c 
    }))
    .sort((a, b) => b.score - a.score);

  // Ranking 2: BM25 (keyword search)
  const bm25Ranking = permitted
    .map(c => ({ 
      id: c.id, 
      score: bm25Score(query, c.text, allDocTexts),
      chunk: c 
    }))
    .sort((a, b) => b.score - a.score);

  // Apply RRF to combine rankings
  const fusedRanking = reciprocalRankFusion([
    vectorRanking.map(r => ({ id: r.id, score: r.score })),
    bm25Ranking.map(r => ({ id: r.id, score: r.score }))
  ]);

  // Map back to chunks and return top K
  const chunkMap = new Map(permitted.map(c => [c.id, c]));
  return fusedRanking
    .slice(0, topK)
    .map(r => chunkMap.get(r.id))
    .filter((c): c is Chunk => c !== undefined);
}

