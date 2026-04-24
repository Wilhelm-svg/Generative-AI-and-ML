# Multimodal Intelligence App

Upload a YouTube video and get: transcript (Whisper), summary + highlights (Groq LLM), and semantic Q&A (sentence-transformers + Groq).

## Architecture

```
POST /process { url }
  │
  ├─ yt-dlp → audio bytes (mp3)
  ├─ Whisper (local) → transcript
  ├─ Groq llama-3.3-70b → summary (≤200 words) + 3-7 highlights
  └─ Store transcript in session (PostgreSQL or in-memory)

POST /qa { session_id, question, use_embeddings }
  │
  ├─ use_embeddings=false → full transcript → Groq LLM → answer
  └─ use_embeddings=true  → sentence-transformers (all-MiniLM-L6-v2) → cosine search → top-3 chunks → Groq LLM → answer
```

## Stack

| Layer | Technology |
|---|---|
| Audio extraction | yt-dlp + FFmpeg |
| Transcription | OpenAI Whisper `base` (local, no API key) |
| Summarization | Groq `llama-3.3-70b-versatile` |
| Q&A | Groq `llama-3.3-70b-versatile` |
| Embeddings | `sentence-transformers all-MiniLM-L6-v2` (local, 80MB) |
| Backend | FastAPI + uvicorn |
| Frontend | Minimal HTML/JS single page |

## Quick Start

```bash
# Install dependencies (includes sentence-transformers)
pip install -r requirements.txt

# Set API key
export GROQ_API_KEY=gsk_...

# Run
uvicorn app.main:app --reload --port 8000
```

Open [http://localhost:8000](http://localhost:8000)

Or with Docker:
```bash
docker compose up multimodal-intelligence-app
```

## API

### Process a video
```bash
curl -X POST http://localhost:8000/process \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
```

Response:
```json
{
  "transcript": "...",
  "summary": "...",
  "highlights": ["...", "...", "..."],
  "session_id": "uuid"
}
```

### Ask a question
```bash
curl -X POST http://localhost:8000/qa \
  -H "Content-Type: application/json" \
  -d '{"session_id":"uuid","question":"What is the main topic?","use_embeddings":true}'
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | Yes | Groq API key |
| `DATABASE_URL` | No | PostgreSQL for session persistence |

## Tests

```bash
pytest tests/ -v   # 16 tests — models, audio validation, QA logic
```
