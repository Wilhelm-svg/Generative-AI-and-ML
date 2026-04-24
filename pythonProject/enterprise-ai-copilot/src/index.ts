import { MemoryStore, createKVStore } from "./memory.js";
import { createCopilotServer } from "./server.js";
import type { OrchestratorDeps } from "./orchestrator.js";
import { groqChat, groqEmbed } from "./groq.js";
import { savePromptVersion } from "../../shared/llmops.js";
import { initDb } from "../../shared/db.js";

const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "";

// ─── Startup validation ───────────────────────────────────────────────────────
const missingEnv: string[] = [];
if (!GROQ_API_KEY) missingEnv.push("GROQ_API_KEY");
if (!process.env.DATABASE_URL) missingEnv.push("DATABASE_URL");
if (missingEnv.length > 0) {
  console.error(`[enterprise-ai-copilot] FATAL: Missing required environment variables: ${missingEnv.join(", ")}`);
  process.exit(1);
}
if (!process.env.JWT_SECRET) console.warn("WARNING: JWT_SECRET not set. Running in dev auth mode — any non-empty token accepted.");
if (!process.env.RESEND_API_KEY) console.warn("WARNING: RESEND_API_KEY not set — email tool disabled.");

const SYSTEM_PROMPT = "You are a helpful enterprise AI assistant. Answer questions based on the provided document context. Be concise and accurate.";

const deps: OrchestratorDeps = {
  // Memory backed by PostgreSQL when DATABASE_URL is set, in-memory otherwise
  memoryStore: new MemoryStore(createKVStore()),
  embedFn: (text) => groqEmbed(text, GROQ_API_KEY),
  llmFn: (prompt) => groqChat(SYSTEM_PROMPT, prompt, GROQ_API_KEY),
  groqApiKey: GROQ_API_KEY,
};

const PORT = Number(process.env.PORT ?? 4002);
const server = createCopilotServer(deps);

await initDb().catch(e => console.warn('[db] Init failed (no DB?):', e));

server.listen(PORT, () => {
  console.log(`Enterprise AI Copilot listening on port ${PORT}`);
  console.log(`Model: llama-3.3-70b-versatile via Groq`);
  console.log(`Auth: ${process.env.JWT_SECRET ? "JWT (HMAC-SHA256)" : "dev mode"}`);
  console.log(`Storage: ${process.env.DATABASE_URL ? "PostgreSQL" : "in-memory"}`);

  // Register active prompt version for observability dashboard
  if (process.env.DATABASE_URL) {
    savePromptVersion("enterprise-ai-copilot", "rag-system", SYSTEM_PROMPT, "llama-3.3-70b-versatile")
      .catch(e => console.warn("[llmops] Failed to save prompt version:", e));
  }
});
