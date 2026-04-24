// ─── Copilot Orchestrator ────────────────────────────────────────────────────

export interface CopilotRequest {
  userId: string;
  sessionToken: string;
  message: string;
}

export interface CopilotResponse {
  answer: string;
  citations?: Citation[];
  toolResult?: ToolResult;
}

export interface Citation {
  documentName: string;
  chunkId: string;
}

// ─── RAG Pipeline ────────────────────────────────────────────────────────────

export interface IngestRequest {
  fileBuffer: Buffer;
  fileName: string;       // .pdf or .txt
  permissions: string[];  // user/role IDs allowed to see this doc
}

export interface RetrieveRequest {
  query: string;
  userId: string;
  topK: number;           // always 5
}

export interface Chunk {
  id: string;
  documentName: string;
  text: string;
  embedding: number[];
  permissions: string[];
}

// ─── Tool Executor ───────────────────────────────────────────────────────────

export type ToolName = "send_email" | "write_db_record";

export interface ToolCall {
  tool: ToolName;
  params: Record<string, unknown>;
  userId: string;
}

export interface ToolResult {
  success: boolean;
  message: string;
}

// ─── Memory Store ────────────────────────────────────────────────────────────

export interface UserMemory {
  userId: string;
  role: string;
  preferences: Record<string, string>;
  recentInteractions: string[];  // last N summaries
}
