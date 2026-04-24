"""Tests for QA engine pure logic — no external deps required."""
import math
from app.models import QAResponse


def _chunk_text(text: str, chunk_size: int = 500):
    """Mirrors _chunk_text from qa.py."""
    words = text.split()
    return [" ".join(words[i:i + chunk_size]) for i in range(0, len(words), chunk_size)] if words else []


def _cosine_similarity(a, b):
    """Mirrors _cosine_similarity from qa.py."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def test_chunk_text_empty():
    assert _chunk_text("") == []


def test_chunk_text_short():
    chunks = _chunk_text("hello world")
    assert len(chunks) == 1
    assert chunks[0] == "hello world"


def test_chunk_text_splits_long_text():
    words = " ".join([f"word{i}" for i in range(1200)])
    chunks = _chunk_text(words, chunk_size=500)
    assert len(chunks) > 1
    for chunk in chunks:
        assert len(chunk.split()) <= 500


def test_cosine_similarity_identical():
    a = [1.0, 0.0, 0.0]
    assert abs(_cosine_similarity(a, a) - 1.0) < 1e-6


def test_cosine_similarity_orthogonal():
    a = [1.0, 0.0]
    b = [0.0, 1.0]
    assert abs(_cosine_similarity(a, b)) < 1e-6


def test_cosine_similarity_zero_vector():
    assert _cosine_similarity([0.0, 0.0], [1.0, 1.0]) == 0.0


def test_qa_response_not_found_structure():
    resp = QAResponse(answer="The answer is not available in the video.", found=False)
    assert resp.found is False
    assert len(resp.answer) > 0
