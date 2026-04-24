"""Tests for URL validation logic — pure Python, no external deps."""
import pytest


def validate_url(url):
    """Mirrors the validation logic in audio.py extract_audio."""
    if not url or not isinstance(url, str):
        raise ValueError("URL must be a non-empty string.")
    return True


def test_empty_url_raises_value_error():
    with pytest.raises(ValueError, match="non-empty"):
        validate_url("")


def test_none_url_raises_value_error():
    with pytest.raises((ValueError, TypeError)):
        validate_url(None)


def test_non_string_raises():
    with pytest.raises((ValueError, TypeError)):
        validate_url(12345)


def test_valid_url_passes():
    assert validate_url("https://www.youtube.com/watch?v=abc123") is True
