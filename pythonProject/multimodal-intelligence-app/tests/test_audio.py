"""Unit tests for extract_audio — task 2.2.
Mocks yt-dlp to avoid real network calls.
"""
import os
import pytest
from unittest.mock import patch, MagicMock


# ── helpers ───────────────────────────────────────────────────────────────────

def _make_ydl_mock(tmpdir: str, filename: str = "audio.mp3", content: bytes = b"FAKEMP3"):
    """Return a context-manager mock for yt_dlp.YoutubeDL that writes a file."""
    def _fake_enter(self):
        # Write a fake audio file into tmpdir so extract_audio finds it
        path = os.path.join(tmpdir, filename)
        with open(path, "wb") as f:
            f.write(content)
        return self

    mock_ydl = MagicMock()
    mock_ydl.__enter__ = _fake_enter
    mock_ydl.__exit__ = MagicMock(return_value=False)
    mock_ydl.extract_info = MagicMock(return_value={"id": "abc123", "title": "Test"})
    return mock_ydl


# ── tests ─────────────────────────────────────────────────────────────────────

def test_extract_audio_valid_url_returns_bytes():
    """Valid URL with mocked yt-dlp returns non-empty bytes."""
    fake_audio = b"FAKEMP3DATA"

    with patch("app.audio.yt_dlp.YoutubeDL") as MockYDL, \
         patch("app.audio.tempfile.TemporaryDirectory") as MockTmpDir:

        # Set up a real temp dir so the file-scan logic works
        import tempfile, contextlib
        real_tmp = tempfile.mkdtemp()

        # Write fake audio file into it
        audio_path = os.path.join(real_tmp, "audio.mp3")
        with open(audio_path, "wb") as f:
            f.write(fake_audio)

        # TemporaryDirectory().__enter__ returns the real_tmp path
        mock_ctx = MagicMock()
        mock_ctx.__enter__ = MagicMock(return_value=real_tmp)
        mock_ctx.__exit__ = MagicMock(return_value=False)
        MockTmpDir.return_value = mock_ctx

        # YoutubeDL context manager
        mock_ydl_instance = MagicMock()
        mock_ydl_instance.__enter__ = MagicMock(return_value=mock_ydl_instance)
        mock_ydl_instance.__exit__ = MagicMock(return_value=False)
        mock_ydl_instance.extract_info = MagicMock(return_value={"id": "abc"})
        MockYDL.return_value = mock_ydl_instance

        from app.audio import extract_audio
        result = extract_audio("https://www.youtube.com/watch?v=abc123")

        assert isinstance(result, bytes)
        assert result == fake_audio

        # cleanup
        import shutil
        shutil.rmtree(real_tmp, ignore_errors=True)


def test_extract_audio_empty_url_raises_value_error():
    """Empty string URL raises ValueError before touching yt-dlp."""
    from app.audio import extract_audio
    with pytest.raises(ValueError, match="non-empty"):
        extract_audio("")


def test_extract_audio_none_url_raises_value_error():
    """None URL raises ValueError."""
    from app.audio import extract_audio
    with pytest.raises(ValueError):
        extract_audio(None)  # type: ignore


def test_extract_audio_non_string_raises_value_error():
    """Non-string URL raises ValueError."""
    from app.audio import extract_audio
    with pytest.raises(ValueError):
        extract_audio(42)  # type: ignore


def test_extract_audio_download_error_raises_value_error():
    """yt-dlp DownloadError is converted to ValueError."""
    import yt_dlp

    with patch("app.audio.yt_dlp.YoutubeDL") as MockYDL:
        mock_ydl_instance = MagicMock()
        mock_ydl_instance.__enter__ = MagicMock(return_value=mock_ydl_instance)
        mock_ydl_instance.__exit__ = MagicMock(return_value=False)
        mock_ydl_instance.extract_info = MagicMock(
            side_effect=yt_dlp.utils.DownloadError("not found")
        )
        MockYDL.return_value = mock_ydl_instance

        from app.audio import extract_audio
        with pytest.raises(ValueError, match="Failed to download"):
            extract_audio("https://www.youtube.com/watch?v=invalid")
