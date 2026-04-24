import type { CopilotRequest, CopilotResponse, Citation } from "./types.js";
import { hybridRetrieve } from "./vectordb.js";
import { executeToolCall, type UserPermissions } from "./tools.js";
import type { MemoryStore } from "./memory.js";
import type { TokenPayload } from "./auth.js";
import { groqChatWithUsage } from "./groq.js";
import { logRequest } from "../../shared/observability.js";

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface OrchestratorDeps {
  memoryStore: MemoryStore;
  embedFn: (text: string) => Promise<number[]>;
  llmFn: (prompt: string) => Promise<string>;
  groqApiKey?: string; // for token tracking
}

// ─── Tool detection ───────────────────────────────────────────────────────────

function detectToolIntent(message: string): {
  isTool: true;
  tool: "send_email" | "write_db_record";
  params: Record<string, unknown>;
} | { isTool: false } {
  const lower = message.toLowerCase();
  if (lower.includes("send email") || lower.includes("email to") || lower.includes("send a message")) {
    const toMatch = message.match(/(?:to|email)\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    if (!toMatch?.[1]) {
      return { isTool: false }; // no valid recipient found — fall through to RAG
    }
    const subjectMatch = message.match(/(?:about|subject:|re:)\s+([^,.\n]+)/i);
    const subject = subjectMatch?.[1]?.trim() ?? "Message from AI Copilot";
    // Build a proper email body from the message intent
    const body = `Dear recipient,\n\n${message}\n\nThis message was sent via the AI Copilot platform.\n\nBest regards,\nAI Copilot`;
    return {
      isTool: true,
      tool: "send_email",
      params: {
        to: toMatch[1],
        subject,
        body,
      },
    };
  }
  if (lower.includes("write record") || lower.includes("save to database") || lower.includes("store this")) {
    return {
      isTool: true,
      tool: "write_db_record",
      params: { content: message, timestamp: new Date().toISOString() },
    };
  }
  return { isTool: false };
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function handleRequest(
  req: CopilotRequest,
  deps: OrchestratorDeps,
  tokenPayload: TokenPayload
): Promise<CopilotResponse> {
  const { memoryStore, embedFn, llmFn } = deps;

  // Per-request permissions derived from the validated token
  const userPermissions: UserPermissions = {
    userId: tokenPayload.userId,
    allowedTools: tokenPayload.allowedTools as ("send_email" | "write_db_record")[],
  };

  // 1. Load user memory
  const memory = await memoryStore.getMemory(tokenPayload.userId);
  const memoryContext = memory
    ? `User role: ${memory.role}\nRecent interactions: ${memory.recentInteractions.slice(-5).join("; ")}`
    : "";

  let response: CopilotResponse;

  // 2. Route: tool or RAG
  const intent = detectToolIntent(req.message);

  if (intent.isTool) {
    // 3. Tool path — use per-request userId from token
    const toolResult = await executeToolCall(
      { tool: intent.tool, params: intent.params, userId: tokenPayload.userId },
      userPermissions
    );
    response = { answer: toolResult.message, toolResult };
  } else {
    // 4. RAG path — query pgvector with hybrid search
    let retrieved: import("./types.js").Chunk[] = [];
    try {
      retrieved = await hybridRetrieve(req.message, tokenPayload.userId, embedFn);
    } catch (e) {
      console.warn("[orchestrator] hybridRetrieve failed (DB unavailable?), returning empty:", e);
    }

    if (retrieved.length === 0) {
      response = { answer: "No relevant content was found for your query." };
    } else {
      const context = retrieved.map((c) => c.text).join("\n\n");
      const prompt = [
        memoryContext ? `Context about user:\n${memoryContext}` : "",
        `Relevant documents:\n${context}`,
        `User question: ${req.message}`,
      ]
        .filter(Boolean)
        .join("\n\n");

      let answer: string;
      if (deps.groqApiKey) {
        const result = await groqChatWithUsage(
          "You are a helpful enterprise AI assistant. Answer questions based on the provided document context. Be concise and accurate.",
          prompt,
          deps.groqApiKey
        );
        answer = result.content;
        logRequest({
          project: "enterprise-ai-copilot",
          endpoint: "/chat/rag",
          userId: tokenPayload.userId,
          latencyMs: 0,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          model: result.model,
          status: "success",
        }).catch(() => {});
      } else {
        answer = await llmFn(prompt);
      }
      const citations: Citation[] = retrieved.map((c) => ({
        documentName: c.documentName,
        chunkId: c.id,
      }));
      response = { answer, citations };
    }
  }

  // 5. Update memory after each turn (using token userId, not req.userId)
  await memoryStore.appendInteraction(tokenPayload.userId, req.message);

  return response;
}
