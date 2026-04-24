# AI Planning Agent

Autonomous AI agent that decomposes tasks into steps using Groq LLM, executes them with real tools (Tavily search, calculator, HTTP API), and logs every action with timestamps.

## Architecture

```
POST /run { task, complexity }
  │
  ├─ Security Check (injection, rate limit, moderation)
  ├─ Cost-aware model routing (fast/balanced/powerful)
  ├─ LLMPlanner → Groq llama-3.3-70b → Plan { steps[] }
  │
  └─ for each Step:
       ToolExecutor (circuit breaker + 3-attempt retry + exponential backoff)
         ├─ search    → Tavily API (real web results)
         ├─ calculator → safe Function() eval
         └─ http-api  → real fetch()
  │
  ├─ AgentResult { success, summary, logs }
  └─ Persist run to PostgreSQL agent_runs table
```

## Stack

| Layer | Technology |
|---|---|
| LLM Planner | Groq `llama-3.3-70b-versatile` (or `llama-3.1-8b-instant` for simple tasks) |
| Search | Tavily API (real web results, 1000/month free) |
| Calculator | Safe `Function()` eval with regex whitelist |
| HTTP | Real `fetch()` to any endpoint |
| Resilience | Circuit breaker + 3-attempt retry + exponential backoff |
| Persistence | PostgreSQL `agent_runs` table |
| Security | Prompt injection detection, RBAC, Redis rate limiting |

## Quick Start

```bash
# Start infrastructure
docker compose up postgres redis -d

# Install and build
npm install && npm run build

# Run
GROQ_API_KEY=gsk_... TAVILY_API_KEY=tvly-... node dist/ai-planning-agent/src/index.js
```

## API

### POST /run
```bash
curl -X POST http://localhost:4003/run \
  -H "Content-Type: application/json" \
  -d '{"task":"What is 15% of 2500? Then search for the latest AI news.","complexity":"medium"}'
```

### GET /runs
```bash
curl http://localhost:4003/runs
```

### GET /status
```bash
curl http://localhost:4003/status
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | Yes | Groq API key |
| `TAVILY_API_KEY` | Yes | Tavily search API key |
| `DATABASE_URL` | No | PostgreSQL for run persistence |
| `REDIS_URL` | No | Redis for rate limiting |
| `PORT` | No | Server port (default: 4003) |

## Tests

```bash
npm test   # 18 tests — logger, registry, planner, executor, agent
```
