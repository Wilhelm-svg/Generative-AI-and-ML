"""Q&A engine grounded in video transcripts — uses Groq llama-3.3-70b (free)."""
import os
from typing import List

from openai import OpenAI
from app.models import QAResponse
from app.embeddings import embed, embed_batch, cosine_similarity

_CHUNK_SIZE = 500
_TOP_K = 3
MODEL = "llama-3.3-70b-versatile"


def _get_client() -> OpenAI:
    return OpenAI(
        api_key=os.environ.get("GROQ_API_KEY", ""),
        base_url="https://api.groq.com/openai/v1",
    )


def _chunk_text(text: str, chunk_size: int = _CHUNK_SIZE) -> List[str]:
    words = text.split()
    return [" ".join(words[i:i + chunk_size]) for i in range(0, len(words), chunk_size)] if words else []


def _vector_search(question: str, chunks: List[str]) -> List[str]:
    """Real semantic vector search using sentence-transformers."""
    if not chunks:
        return []
    q_emb = embed(question)
    chunk_embs = embed_batch(chunks)
    scored = [(cosine_similarity(q_emb, c_emb), chunk) for c_emb, chunk in zip(chunk_embs, chunks)]
    scored.sort(key=lambda x: x[0], reverse=True)
    return [c for _, c in scored[:_TOP_K]]


_SYSTEM = """You are a helpful assistant that answers questions about video content.
Answer ONLY based on the provided transcript context.
If the answer is not present, respond with exactly: NOT_FOUND
Be concise and factual."""


def answer(question: str, transcript: str, use_embeddings: bool = False) -> QAResponse:
    if not question or not question.strip():
        return QAResponse(answer="", found=False)
    if not transcript or not transcript.strip():
        return QAResponse(answer="", found=False)

    if use_embeddings:
        chunks = _chunk_text(transcript)
        context = "\n\n".join(_vector_search(question, chunks))
    else:
        context = " ".join(transcript.split()[:4000])

    try:
        response = _get_client().chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": f"Transcript:\n{context}\n\nQuestion: {question}"},
            ],
            temperature=0.2,
            max_tokens=512,
        )
    except Exception as exc:
        raise RuntimeError(f"LLM Q&A failed: {exc}") from exc

    raw = (response.choices[0].message.content or "").strip()
    if not raw or raw == "NOT_FOUND":
        return QAResponse(answer="The answer is not available in the video.", found=False)
    return QAResponse(answer=raw, found=True)
