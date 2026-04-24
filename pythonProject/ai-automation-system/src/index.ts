import { PgJobStore } from "./pgJobStore.js";
import { RedisJobQueue, InMemoryFallbackQueue } from "./redisQueue.js";
import { Processor } from "./processor.js";
import { createServer } from "./server.js";
import { initDb } from "../../shared/db.js";

const PORT = parseInt(process.env["PORT"] ?? "4001", 10);

// ─── Startup validation ───────────────────────────────────────────────────────
const missingEnv: string[] = [];
if (!process.env.GROQ_API_KEY) missingEnv.push("GROQ_API_KEY");
if (!process.env.DATABASE_URL) missingEnv.push("DATABASE_URL");
if (missingEnv.length > 0) {
  console.error(`[ai-automation-system] FATAL: Missing required environment variables: ${missingEnv.join(", ")}`);
  process.exit(1);
}
if (!process.env.RESEND_API_KEY) console.warn("[ai-automation-system] WARNING: RESEND_API_KEY not set — auto-reply emails disabled");
if (!process.env.TICKET_WEBHOOK_URL) console.warn("[ai-automation-system] WARNING: TICKET_WEBHOOK_URL not set — ticket routing webhook disabled");

const store = new PgJobStore();

let queue: RedisJobQueue | InMemoryFallbackQueue;
try {
  queue = new RedisJobQueue();
  console.log("Using Redis-backed job queue");
} catch {
  console.warn("Redis unavailable — falling back to in-memory queue");
  queue = new InMemoryFallbackQueue();
}

const processor = new Processor(store as never, queue as never);
const server = createServer(store as never, queue as never);

processor.start();

// Wrap in async IIFE — ai-automation-system is CommonJS (no "type":"module"), no top-level await
(async () => {
  await initDb().catch(e => console.warn("[db] Init failed (no DB?):", e));

  server.listen(PORT, () => {
    console.log(`AI Automation System listening on port ${PORT}`);
    console.log(`Storage: PostgreSQL | Queue: ${queue instanceof RedisJobQueue ? "Redis" : "In-Memory"}`);
  });
})();

process.on("SIGTERM", () => { processor.stop(); server.close(() => process.exit(0)); });
process.on("SIGINT",  () => { processor.stop(); server.close(() => process.exit(0)); });
