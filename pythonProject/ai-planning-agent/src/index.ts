import { InMemoryLogger } from './logger.js';
import { InMemoryToolRegistry } from './toolRegistry.js';
import { LLMPlanner, StubPlanner } from './planner.js';
import { ToolExecutor } from './executor.js';
import { PlanningAgent } from './agent.js';
import { searchTool } from './tools/search.js';
import { calculatorTool } from './tools/calculator.js';
import { httpApiTool } from './tools/httpApi.js';
import { createAgentServer } from './server.js';
import { selectModel, savePromptVersion } from '../../shared/llmops.js';
import { initDb } from '../../shared/db.js';
import type { AgentResult } from './types.js';

const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "";
const PORT = parseInt(process.env.PORT ?? "4003", 10);

// ─── Startup validation ───────────────────────────────────────────────────────
const missingEnv: string[] = [];
if (!GROQ_API_KEY) missingEnv.push("GROQ_API_KEY");
if (!process.env.DATABASE_URL) missingEnv.push("DATABASE_URL");
if (missingEnv.length > 0) {
  console.error(`[ai-planning-agent] FATAL: Missing required environment variables: ${missingEnv.join(", ")}`);
  process.exit(1);
}

function buildAgent(model?: string): PlanningAgent {
  const logger = new InMemoryLogger();
  const registry = new InMemoryToolRegistry();
  registry.register(searchTool);
  registry.register(calculatorTool);
  registry.register(httpApiTool);
  const planner = new LLMPlanner(GROQ_API_KEY, model);
  const executor = new ToolExecutor(registry, logger);
  return new PlanningAgent(planner, executor, logger);
}

async function runAgent(task: string, model: string): Promise<AgentResult> {
  const agent = buildAgent(model);
  return agent.run(task);
}

// Export for library use
export default buildAgent();
export { InMemoryLogger, InMemoryToolRegistry, LLMPlanner, StubPlanner, ToolExecutor, PlanningAgent };
export { searchTool, calculatorTool, httpApiTool };

// Start HTTP server
const server = createAgentServer(runAgent);

await initDb().catch(e => console.warn('[db] Init failed (no DB?):', e));

server.listen(PORT, () => {
  console.log(`AI Planning Agent listening on port ${PORT}`);
  console.log(`Model routing: fast=${selectModel("low")} | balanced=${selectModel("medium")} | powerful=${selectModel("high")}`);

  // Register active prompt version for observability dashboard
  if (process.env.DATABASE_URL && GROQ_API_KEY) {
    savePromptVersion("ai-planning-agent", "task-planner", "You are a task planner. Given a task, break it into steps using available tools.", "llama-3.3-70b-versatile")
      .catch(e => console.warn("[llmops] Failed to save prompt version:", e));
  }
});
