import agent from './dist/index.js';

console.log("Testing Tavily search...");
const result = await agent.run("Search for the latest news about artificial intelligence in 2025");
const steps = result.logs.filter(l => l.event === "step_end");
console.log(JSON.stringify({
  success: result.success,
  summary: result.summary?.slice(0, 300),
  steps: steps.map(s => ({
    tool: s.toolName,
    output: JSON.stringify(s.output)?.slice(0, 400)
  }))
}, null, 2));
