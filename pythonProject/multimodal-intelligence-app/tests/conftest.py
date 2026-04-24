"""Pytest configuration — stubs heavy optional deps (whisper, yt_dlp)
so tests can run without those packages installed.
"""
import sys
import types
from unittest.mock import MagicMock


def _stub_module(name: str) -> MagicMock:
    mod = MagicMock(spec=types.ModuleType(name))
    sys.modules[name] = mod
    return mod


# Stub whisper — provide Whisper class for type annotations in transcriber.py
if "whisper" not in sys.modules:
    whisper_stub = _stub_module("whisper")
    whisper_stub.Whisper = type("Whisper", (), {})
    whisper_stub.load_model = MagicMock(return_value=MagicMock())

# Stub yt_dlp with real exception classes so isinstance checks work
if "yt_dlp" not in sys.modules:
    yt_dlp_stub = _stub_module("yt_dlp")
    utils_stub = _stub_module("yt_dlp.utils")
    yt_dlp_stub.utils = utils_stub
    utils_stub.DownloadError = type("DownloadError", (Exception,), {})
    utils_stub.ExtractorError = type("ExtractorError", (Exception,), {})
    yt_dlp_stub.YoutubeDL = MagicMock()
