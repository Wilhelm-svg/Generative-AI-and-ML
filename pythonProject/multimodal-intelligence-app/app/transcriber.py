"""Speech-to-text transcription using OpenAI Whisper."""
import os
import tempfile

import whisper


_model = None


def _get_model(model_name: str = "small") -> whisper.Whisper:
    """Lazy-load and cache the Whisper model."""
    global _model
    if _model is None:
        _model = whisper.load_model(model_name)
    return _model


def transcribe(audio: bytes, model_name: str = "small") -> str:
    """Convert audio bytes to a plain-text transcript using Whisper.

    Args:
        audio: Raw audio bytes (e.g., mp3, wav, m4a).
        model_name: Whisper model size to use (default: "base").

    Returns:
        Plain-text transcript string.

    Raises:
        RuntimeError: If transcription fails for any reason.
    """
    if not audio:
        raise RuntimeError("Cannot transcribe empty audio bytes.")

    try:
        model = _get_model(model_name)

        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
            tmp.write(audio)
            tmp_path = tmp.name

        try:
            result = model.transcribe(tmp_path)
        finally:
            os.unlink(tmp_path)

        text = result.get("text", "").strip()
        if not text:
            raise RuntimeError("Whisper returned an empty transcript.")
        return text

    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError(f"Transcription failed: {exc}") from exc
