"""LLM-based summarization and highlight extraction — uses Groq (free)."""
import json
import os

from openai import OpenAI

from app.models import SummaryResult


def _get_client() -> OpenAI:
    return OpenAI(
        api_key=os.environ.get("GROQ_API_KEY", ""),
        base_url="https://api.groq.com/openai/v1",
    )


MODEL = "llama-3.3-70b-versatile"


_SYSTEM_PROMPT = """You are a helpful assistant that summarizes video transcripts.
You MUST respond with valid JSON only, in this exact format:
{
  "summary": "<concise summary in no more than 200 words>",
  "highlights": ["<highlight 1>", "<highlight 2>", ..., "<highlight N>"]
}
Rules:
- summary must be 200 words or fewer
- highlights must contain between 3 and 7 items
- each highlight is a single concise bullet point
- respond with JSON only, no extra text"""


def summarize(transcript: str) -> SummaryResult:
    """Generate a summary and key highlights from a transcript.

    Args:
        transcript: Plain-text transcript to summarize.
        model: OpenAI model to use.

    Returns:
        SummaryResult with summary (≤200 words) and 3–7 highlights.

    Raises:
        RuntimeError: If the LLM call fails or returns invalid output.
    """
    if not transcript or not transcript.strip():
        raise RuntimeError("Cannot summarize an empty transcript.")

    try:
        response = _get_client().chat.completions.create(            model=MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": f"Summarize the following transcript:\n\n{transcript}",
                },
            ],
            temperature=0.3,
            response_format={"type": "json_object"},
        )
    except Exception as exc:
        raise RuntimeError(f"LLM summarization request failed: {exc}") from exc

    raw = response.choices[0].message.content or ""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"LLM returned invalid JSON: {raw!r}") from exc

    summary = data.get("summary", "").strip()
    highlights = data.get("highlights", [])

    if not summary:
        raise RuntimeError("LLM returned an empty summary.")
    if not isinstance(highlights, list) or not (3 <= len(highlights) <= 7):
        raise RuntimeError(
            f"LLM returned {len(highlights)} highlights; expected 3–7."
        )

    return SummaryResult(summary=summary, highlights=highlights)
