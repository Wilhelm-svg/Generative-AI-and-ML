"""FastAPI application for the Multimodal Intelligence App — uses Groq (free)."""
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Optional

import psycopg2
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.audio import extract_audio
from app.models import ProcessResponse, QAResponse
from app.qa import answer
from app.summarizer import summarize
from app.transcriber import transcribe

# ── Startup validation ────────────────────────────────────────────────────────

_missing = [v for v in ("GROQ_API_KEY", "DATABASE_URL") if not os.environ.get(v)]
if _missing:
    print(f"[multimodal-intelligence-app] FATAL: Missing required environment variables: {', '.join(_missing)}", file=sys.stderr)
    sys.exit(1)

app = FastAPI(title="Multimodal Intelligence App")

# ── CORS middleware ────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for demo purposes
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Observability middleware ───────────────────────────────────────────────────

def _log_request(endpoint: str, latency_ms: int, status: str, error: str = None):
    """Log request to PostgreSQL request_logs table."""
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        return
    try:
        conn = psycopg2.connect(db_url)
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO request_logs (project, endpoint, latency_ms, status, error_msg)
                   VALUES (%s, %s, %s, %s, %s)""",
                ("multimodal-intelligence-app", endpoint, latency_ms, status, error),
            )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[observability] Failed to log: {e}")

# ── Session store: PostgreSQL when DATABASE_URL is set, in-memory fallback ───

_sessions: dict[str, str] = {}  # in-memory fallback


def _get_db():
    """Return a psycopg2 connection, or None if DATABASE_URL is not set."""
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        return None
    try:
        import psycopg2  # type: ignore
        return psycopg2.connect(db_url)
    except Exception as e:
        print(f"[session] DB connection failed: {e}")
        return None


def _save_session(session_id: str, url: str, transcript: str, summary: str, highlights: list[str]) -> None:
    """Persist session to PostgreSQL, fall back to in-memory."""
    _sessions[session_id] = transcript  # always keep in-memory for fast lookup
    conn = _get_db()
    if conn is None:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO video_sessions (session_id, url, transcript, summary, highlights)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (session_id) DO UPDATE
                   SET transcript = EXCLUDED.transcript,
                       summary = EXCLUDED.summary,
                       highlights = EXCLUDED.highlights""",
                (session_id, url, transcript, summary, highlights),
            )
        conn.commit()
    except Exception as e:
        print(f"[session] Failed to persist session: {e}")
    finally:
        conn.close()


def _load_session(session_id: str) -> Optional[str]:
    """Load transcript from in-memory cache first, then PostgreSQL."""
    if session_id in _sessions:
        return _sessions[session_id]
    conn = _get_db()
    if conn is None:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT transcript FROM video_sessions WHERE session_id = %s", (session_id,)
            )
            row = cur.fetchone()
            if row:
                _sessions[session_id] = row[0]  # warm the in-memory cache
                return row[0]
    except Exception as e:
        print(f"[session] Failed to load session: {e}")
    finally:
        conn.close()
    return None


# ── Request / Response schemas ────────────────────────────────────────────────

class ProcessRequest(BaseModel):
    url: str


class QARequestBody(BaseModel):
    session_id: str
    question: str
    use_embeddings: bool = False


# ── Routes ────────────────────────────────────────────────────────────────────

@app.post("/process", response_model=dict)
async def process_video(req: ProcessRequest):
    """Accept a YouTube URL, run the full pipeline, return transcript + summary."""
    _start = time.time()
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL must not be empty.")

    # 1. Extract audio
    try:
        audio_bytes = extract_audio(url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Audio extraction failed: {exc}")

    # 2. Transcribe
    try:
        transcript = transcribe(audio_bytes)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}")

    # 3. Summarize
    try:
        result = summarize(transcript)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Summarization failed: {exc}")

    # 4. Persist session (PostgreSQL + in-memory)
    session_id = str(uuid.uuid4())
    _save_session(session_id, url, transcript, result.summary, result.highlights)
    _log_request("/process", int((time.time() - _start) * 1000), "success")

    return ProcessResponse(
        transcript=transcript,
        summary=result.summary,
        highlights=result.highlights,
        session_id=session_id,
    ).__dict__


@app.get("/telemetry")
async def telemetry_endpoint():
    """Returns recent request telemetry for the AI Control Center collector."""
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        return []
    try:
        conn = psycopg2.connect(db_url)
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, endpoint, latency_ms, status, created_at
                   FROM request_logs
                   WHERE project = 'multimodal-intelligence-app'
                   ORDER BY created_at DESC LIMIT 50"""
            )
            rows = cur.fetchall()
        conn.close()
        return [
            {
                "queryId": str(row[0]),
                "timestamp": row[4].isoformat(),
                "latencyMs": row[2] or 0,
                "success": row[3] == "success",
                "modelId": "llama-3.3-70b-versatile",
                "tokensIn": 0,
                "tokensOut": 0,
                "costUsd": 0.0,
            }
            for row in rows
        ]
    except Exception as e:
        print(f"[telemetry] Failed to fetch: {e}")
        return []


@app.get("/health")
async def health_endpoint():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "multimodal-intelligence-app",
        "timestamp": time.time(),
    }


@app.post("/qa", response_model=dict)
async def qa_endpoint(req: QARequestBody):
    """Answer a question about a previously processed video."""
    _start = time.time()
    transcript = _load_session(req.session_id)
    if transcript is None:
        raise HTTPException(
            status_code=404,
            detail=f"Session '{req.session_id}' not found. Please process a video first.",
        )

    if not req.question or not req.question.strip():
        raise HTTPException(status_code=400, detail="Question must not be empty.")

    try:
        qa_response: QAResponse = answer(
            question=req.question,
            transcript=transcript,
            use_embeddings=req.use_embeddings,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Q&A failed: {exc}")

    _log_request("/qa", int((time.time() - _start) * 1000), "success")
    return qa_response.__dict__


# ── Static files ──────────────────────────────────────────────────────────────

_static_dir = Path(__file__).parent.parent / "static"
if _static_dir.exists():
    app.mount("/", StaticFiles(directory=str(_static_dir), html=True), name="static")
