"""Unit tests for API error responses — task 6.3.
Tests 400 on bad URL, 500 on transcription failure, found=false on empty retrieval.
Requirements: 1.3, 2.3, 4.4
"""
from unittest.mock import MagicMock, patch
import pytest

# conftest.py stubs whisper and yt_dlp before these imports
from fastapi.testclient import TestClient
from app.main import app, _sessions
from app.models import QAResponse

client = TestClient(app)


# ── /process error paths ──────────────────────────────────────────────────────

def test_process_empty_url_returns_400():
    """Requirement 1.3: empty URL → 400."""
    resp = client.post("/process", json={"url": ""})
    assert resp.status_code == 400


def test_process_invalid_url_returns_400():
    """Requirement 1.3: invalid URL (ValueError from extract_audio) → 400."""
    with patch("app.main.extract_audio", side_effect=ValueError("bad url")):
        resp = client.post("/process", json={"url": "not-a-real-url"})
    assert resp.status_code == 400
    assert "bad url" in resp.json()["detail"]


def test_process_transcription_failure_returns_500():
    """Requirement 2.3: transcription RuntimeError → 500."""
    with patch("app.main.extract_audio", return_value=b"FAKEAUDIO"), \
         patch("app.main.transcribe", side_effect=RuntimeError("whisper crashed")):
        resp = client.post("/process", json={"url": "https://youtube.com/watch?v=abc"})
    assert resp.status_code == 500
    assert "whisper crashed" in resp.json()["detail"]


def test_process_summarization_failure_returns_503():
    """LLM summarization RuntimeError → 503."""
    with patch("app.main.extract_audio", return_value=b"FAKEAUDIO"), \
         patch("app.main.transcribe", return_value="some transcript"), \
         patch("app.main.summarize", side_effect=RuntimeError("LLM down")):
        resp = client.post("/process", json={"url": "https://youtube.com/watch?v=abc"})
    assert resp.status_code == 503
    assert "LLM down" in resp.json()["detail"]


def test_process_generic_extraction_error_returns_500():
    """Unexpected exception during extraction → 500."""
    with patch("app.main.extract_audio", side_effect=Exception("network timeout")):
        resp = client.post("/process", json={"url": "https://youtube.com/watch?v=abc"})
    assert resp.status_code == 500


# ── /qa error paths ───────────────────────────────────────────────────────────

def test_qa_unknown_session_returns_404():
    """Unknown session_id → 404."""
    resp = client.post("/qa", json={
        "session_id": "nonexistent-session-id",
        "question": "What is this about?",
    })
    assert resp.status_code == 404


def test_qa_empty_question_returns_400():
    """Empty question → 400."""
    _sessions["test-session-empty-q"] = "Some transcript text."
    resp = client.post("/qa", json={
        "session_id": "test-session-empty-q",
        "question": "",
    })
    assert resp.status_code == 400
    _sessions.pop("test-session-empty-q", None)


def test_qa_not_found_returns_found_false():
    """Requirement 4.4: when answer() returns found=False, API returns found=false."""
    _sessions["test-session-nf"] = "Some transcript text."

    with patch("app.main.answer", return_value=QAResponse(
        answer="The answer is not available in the video.", found=False
    )):
        resp = client.post("/qa", json={
            "session_id": "test-session-nf",
            "question": "What is the meaning of life?",
        })

    assert resp.status_code == 200
    data = resp.json()
    assert data["found"] is False
    assert len(data["answer"]) > 0
    _sessions.pop("test-session-nf", None)


def test_qa_llm_failure_returns_503():
    """Requirement 4.4: RuntimeError from answer() → 503."""
    _sessions["test-session-err"] = "Some transcript text."

    with patch("app.main.answer", side_effect=RuntimeError("LLM Q&A failed")):
        resp = client.post("/qa", json={
            "session_id": "test-session-err",
            "question": "What happened?",
        })

    assert resp.status_code == 503
    _sessions.pop("test-session-err", None)


def test_qa_success_returns_answer_and_found_true():
    """Happy path: valid session + question returns answer with found=True."""
    _sessions["test-session-ok"] = "The sky is blue because of Rayleigh scattering."

    with patch("app.main.answer", return_value=QAResponse(
        answer="Rayleigh scattering.", found=True
    )):
        resp = client.post("/qa", json={
            "session_id": "test-session-ok",
            "question": "Why is the sky blue?",
        })

    assert resp.status_code == 200
    data = resp.json()
    assert data["found"] is True
    assert "Rayleigh" in data["answer"]
    _sessions.pop("test-session-ok", None)
