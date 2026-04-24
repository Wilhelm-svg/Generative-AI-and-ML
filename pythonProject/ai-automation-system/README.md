# AI Automation System

Production-grade business automation pipeline. Accepts unstructured inputs (invoices, emails, support tickets), processes them with Groq LLM, and returns structured JSON with confidence scores. Sends real email auto-replies via Resend.

## Architecture

```
POST /jobs
  │
  ├─ Input validation (size ≤100KB, valid pipeline_type)
  ├─ Create job in PostgreSQL
  ├─ Enqueue to Redis (durable) or in-memory fallback
  │
  └─ Processor (async, 30s timeout)
       ├─ invoice_extraction   → Groq LLM → { vendor, amount, currency, date, line_items }
       ├─ email_classification → Groq LLM → { category, intent, sender, summary } + Resend auto-reply
       └─ support_ticket_categorization → Groq LLM → { category, priority, routing } + webhook

GET /jobs/:id → { status, result, error }
```

## Stack

| Layer | Technology |
|---|---|
| LLM Extraction | Groq `llama-3.3-70b-versatile` with `response_format: json_object` |
| Job Store | PostgreSQL `jobs` table (durable, survives restarts) |
| Queue | Redis RPUSH/BLPOP (durable) with in-memory fallback |
| Email Auto-reply | Resend API with category-specific templates |
| Ticket Routing | Webhook POST to `TICKET_WEBHOOK_URL` |

## Quick Start

```bash
# Start infrastructure
docker compose up postgres redis -d

# Install and build
npm install && npm run build

# Run
GROQ_API_KEY=gsk_... RESEND_API_KEY=re_... node dist/ai-automation-system/src/index.js
```

## API

### Submit an invoice
```bash
curl -X POST http://localhost:4001/jobs \
  -H "Content-Type: application/json" \
  -d '{"pipeline_type":"invoice_extraction","input_text":"Vendor: Acme Corp\nTotal: $3000\nDate: 2024-03-15\nItems: Software License $2500, Support $500"}'
```

### Submit an email for classification + auto-reply
```bash
curl -X POST http://localhost:4001/jobs \
  -H "Content-Type: application/json" \
  -d '{"pipeline_type":"email_classification","input_text":"From: customer@example.com\nI am unhappy with my order. Please refund immediately."}'
```

### Check job result
```bash
curl http://localhost:4001/jobs/<job_id>
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | Yes | Groq API key |
| `RESEND_API_KEY` | Yes | Resend for email auto-replies |
| `DATABASE_URL` | Yes (prod) | PostgreSQL connection string |
| `REDIS_URL` | No | Redis queue (falls back to in-memory) |
| `TICKET_WEBHOOK_URL` | No | Webhook for ticket routing |
| `PORT` | No | Server port (default: 4001) |

## Tests

```bash
npm test   # 22 tests — validation, job store, extractors, properties
```
