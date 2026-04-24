"""
Real semantic embeddings using sentence-transformers (free, runs locally).
Falls back to hash-based embeddings if sentence-transformers not installed.
"""
import math
from typing import List

_model = None


def _get_model():
    global _model
    if _model is None:
        try:
            from sentence_transformers import SentenceTransformer
            _model = SentenceTransformer("all-MiniLM-L6-v2")  # 80MB, fast, good quality
        except ImportError:
            _model = "hash"  # fallback
    return _model


def embed(text: str) -> List[float]:
    """Return a semantic embedding vector for the given text."""
    model = _get_model()
    if model == "hash":
        return _hash_embed(text, 384)
    return model.encode(text, normalize_embeddings=True).tolist()


def embed_batch(texts: List[str]) -> List[List[float]]:
    """Embed multiple texts efficiently."""
    model = _get_model()
    if model == "hash":
        return [_hash_embed(t, 384) for t in texts]
    return model.encode(texts, normalize_embeddings=True).tolist()


def cosine_similarity(a: List[float], b: List[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    return dot / (norm_a * norm_b) if norm_a and norm_b else 0.0


def _hash_embed(text: str, dims: int) -> List[float]:
    vec = [0.0] * dims
    for i, c in enumerate(text):
        vec[i % dims] += ord(c) / 255
    norm = math.sqrt(sum(v * v for v in vec)) or 1
    return [v / norm for v in vec]
