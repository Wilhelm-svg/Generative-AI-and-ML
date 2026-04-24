"""Tests for transcriber — tasks 3.2 (Property 1) and 3.3 (failure path).
Mocks whisper to avoid loading real models.
"""
# Feature: multimodal-intelligence-app, Property 1

import pytest
from unittest.mock import patch, MagicMock
from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st


# ── helpers ───────────────────────────────────────────────────────────────────

def _mock_whisper_model(text: str):
    """Return a mock whisper model that transcribes to `text`."""
    mock_model = MagicMock()
    mock_model.transcribe = MagicMock(return_value={"text": text})
    return mock_model


# ── Property 1: Transcriber always returns a non-empty string ─────────────────
# Validates: Requirements 2.1

@given(
    transcript_text=st.text(
        alphabet=st.characters(blacklist_categories=("Cs",)),
        min_size=1,
        max_size=500,
    ).filter(lambda t: t.strip() != "")
)
@settings(max_examples=50, suppress_health_check=[HealthCheck.too_slow])
def test_property1_transcriber_returns_nonempty_string(transcript_text):
    """Property 1: transcribe() always returns a non-empty string for valid audio.
    Validates: Requirements 2.1
    """
    fake_audio = b"FAKEAUDIO"

    with patch("app.transcriber._get_model") as mock_get_model, \
         patch("app.transcriber.tempfile.NamedTemporaryFile") as mock_tmp, \
         patch("app.transcriber.os.unlink"):

        mock_get_model.return_value = _mock_whisper_model(transcript_text)

        # Mock the temp file context manager
        mock_file = MagicMock()
        mock_file.__enter__ = MagicMock(return_value=mock_file)
        mock_file.__exit__ = MagicMock(return_value=False)
        mock_file.name = "/tmp/fake_audio.mp3"
        mock_tmp.return_value = mock_file

        from app.transcriber import transcribe
        result = transcribe(fake_audio)

        assert isinstance(result, str)
        assert len(result) > 0


# ── Task 3.3: Unit tests for transcription failure path ──────────────────────
# Requirements: 2.3

def test_transcribe_empty_audio_raises_runtime_error():
    """Empty bytes raises RuntimeError before touching whisper."""
    from app.transcriber import transcribe
    with pytest.raises(RuntimeError, match="empty audio"):
        transcribe(b"")


def test_transcribe_whisper_exception_raises_runtime_error():
    """If whisper.transcribe raises, RuntimeError is propagated."""
    with patch("app.transcriber._get_model") as mock_get_model, \
         patch("app.transcriber.tempfile.NamedTemporaryFile") as mock_tmp, \
         patch("app.transcriber.os.unlink"):

        mock_model = MagicMock()
        mock_model.transcribe = MagicMock(side_effect=Exception("GPU OOM"))
        mock_get_model.return_value = mock_model

        mock_file = MagicMock()
        mock_file.__enter__ = MagicMock(return_value=mock_file)
        mock_file.__exit__ = MagicMock(return_value=False)
        mock_file.name = "/tmp/fake_audio.mp3"
        mock_tmp.return_value = mock_file

        from app.transcriber import transcribe
        with pytest.raises(RuntimeError, match="Transcription failed"):
            transcribe(b"FAKEAUDIO")


def test_transcribe_empty_text_result_raises_runtime_error():
    """Whisper returning empty text raises RuntimeError."""
    with patch("app.transcriber._get_model") as mock_get_model, \
         patch("app.transcriber.tempfile.NamedTemporaryFile") as mock_tmp, \
         patch("app.transcriber.os.unlink"):

        mock_get_model.return_value = _mock_whisper_model("   ")  # whitespace only

        mock_file = MagicMock()
        mock_file.__enter__ = MagicMock(return_value=mock_file)
        mock_file.__exit__ = MagicMock(return_value=False)
        mock_file.name = "/tmp/fake_audio.mp3"
        mock_tmp.return_value = mock_file

        from app.transcriber import transcribe
        with pytest.raises(RuntimeError, match="empty transcript"):
            transcribe(b"FAKEAUDIO")


def test_transcribe_valid_audio_returns_text():
    """Happy path: valid audio bytes returns the transcript string."""
    with patch("app.transcriber._get_model") as mock_get_model, \
         patch("app.transcriber.tempfile.NamedTemporaryFile") as mock_tmp, \
         patch("app.transcriber.os.unlink"):

        mock_get_model.return_value = _mock_whisper_model("Hello world transcript.")

        mock_file = MagicMock()
        mock_file.__enter__ = MagicMock(return_value=mock_file)
        mock_file.__exit__ = MagicMock(return_value=False)
        mock_file.name = "/tmp/fake_audio.mp3"
        mock_tmp.return_value = mock_file

        from app.transcriber import transcribe
        result = transcribe(b"FAKEAUDIO")
        assert result == "Hello world transcript."
