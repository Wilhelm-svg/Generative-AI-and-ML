# Enterprise AI Copilot

Production-grade RAG + Actions AI assistant. Answers questions from company documents using hybrid vector search and executes real actions (email, database writes).

## Architecture

```
Client
  │
  ├─ POST /chat      → Auth → Security Check → Orchestrator
  │                                               ├─ RAG: pgvector hybrid search + reranking → Groq LLM → Citations
  │                                               └─ Tools: send_email (Resend) | write_db_record (JSON file)
  │
  ├─ POST /ingest    → Chunk (fixed/sentence/paragraph) → Embed (Groq nomic) → pgvector
  ├─ GET  /status    → Health + observability stats + eval summary
  └─ GET  /eval      → RAG evaluation results (groundedness, relevance, hallucination)
```

## Stack

| Layer | Technology |
|---|---|
| LLM | Groq `llama-3.3-70b-versatile` |
| Embeddings | Groq `nomic-embed-text-v1_5` (768-dim) |
| Vector DB | PostgreSQL + pgvector (hybrid: cosine + BM25 + RRF reranking) |
| Memory | PostgreSQL `user_memory` table |
| Email | Resend API |
| DB Write | JSON file persistence |
| Security | Prompt injection detection, RBAC, rate limiting (Redis) |
| Evaluation | LLM-as-judge: groundedness, answer relevance, hallucination detection |
| Observability | PostgreSQL `request_logs` — latency, tokens, cost per query |

## Quick Start

```bash
# 1. Start infrastructure
docker compose up postgres redis -d

# 2. Install and build
npm install && npm run build

# 3. Run
GROQ_API_KEY=gsk_... RESEND_API_KEY=re_... node dist/enterprise-ai-copilot/src/index.js
```

Or with Docker:
```bash
docker compose up enterprise-ai-copilot
```

## API

### POST /chat
```bash
curl -X POST http://localhost:4002/chat \
  -H "Content-Type: application/json" \
  -H "X-User-Role: user" \
  -d '{"userId":"user1","sessionToken":"token","message":"What is the refund policy?"}'
```

### POST /ingest
```bash
curl -X POST http://localhost:4002/ingest \
  -H "Content-Type: application/json" \
  -d '{"text":"Your policy text here...","fileName":"policy.txt","permissions":["user1"],"chunkStrategy":"sentence"}'
```

### GET /status
```bash
curl http://localhost:4002/status
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | Yes | Groq API key |
| `RESEND_API_KEY` | Yes | Resend email API key |
| `DATABASE_URL` | Yes (prod) | PostgreSQL connection string |
| `REDIS_URL` | No | Redis for rate limiting (default: localhost:6379) |
| `PORT` | No | Server port (default: 4002) |

## Tests

```bash
npm test   # 33 tests — auth, RAG, memory, tools
```
