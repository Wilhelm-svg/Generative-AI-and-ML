/**
 * Entry point — starts the AI Decision System HTTP server
 */

import { createServer } from "./server";
import { initDb } from "../../shared/db";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;

// ─── Startup validation ───────────────────────────────────────────────────────
const missingEnv: string[] = [];
if (!process.env.DATABASE_URL) missingEnv.push("DATABASE_URL");
if (missingEnv.length > 0) {
  console.error(`[ai-decision-system] FATAL: Missing required environment variables: ${missingEnv.join(", ")}`);
  process.exit(1);
}

async function main() {
  await initDb().catch(e => console.warn('[db] Init failed (no DB?):', e));

  const server = createServer();
  server.listen(PORT, () => {
    console.log(`AI Decision System API listening on http://localhost:${PORT}`);
    console.log("Endpoints:");
    console.log("  POST /predict");
    console.log("  GET  /predictions");
    console.log("  GET  /predictions/:id");
    console.log("  GET  /insights");
  });
}

main().catch(e => { console.error(e); process.exit(1); });
