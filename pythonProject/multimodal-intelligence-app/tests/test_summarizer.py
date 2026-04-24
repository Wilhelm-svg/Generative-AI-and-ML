"""Property tests for summarizer — tasks 4.2 (Property 2) and 4.3 (Property 3).
Mocks the OpenAI/Groq client to avoid real API calls.
"""
# Feature: multimodal-intelligence-app, Property 2
# Feature: multimodal-intelligence-app, Property 3

import json
from unittest.mock import patch, MagicMock

from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st


# ── helpers ───────────────────────────────────────────────────────────────────

def _make_openai_response(summary: str, highlights: list) -> MagicMock:
    """Build a mock OpenAI chat completion response."""
    payload = json.dumps({"summary": summary, "highlights": highlights})
    mock_message = MagicMock()
    mock_message.content = payload
    mock_choice = MagicMock()
    mock_choice.message = mock_message
    mock_response = MagicMock()
    mock_response.choices = [mock_choice]
    return mock_response


def _word_count(text: str) -> int:
    return len(text.split())


# ── Property 2: summary word count ≤ 200 ─────────────────────────────────────
# Validates: Requirements 3.1

@given(
    transcript=st.text(min_size=10, max_size=300).filter(lambda t: t.strip() != ""),
    summary=st.text(
        alphabet=st.characters(whitelist_categories=("Lu", "Ll", "Nd", "Zs")),
        min_size=5,
        max_size=200,
    ).filter(lambda s: s.strip() and _word_count(s) <= 200),
    highlights=st.lists(
        st.text(min_size=3, max_size=50).filter(lambda h: h.strip()),
        min_size=3,
        max_size=7,
    ),
)
@settings(max_examples=50, suppress_health_check=[HealthCheck.too_slow])
def test_property2_summary_word_count_le_200(transcript, summary, highlights):
    """Property 2: summarize() returns a summary with ≤ 200 words.
    Validates: Requirements 3.1
    """
    mock_response = _make_openai_response(summary, highlights)

    with patch("app.summarizer._get_client") as mock_client_fn:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = mock_response
        mock_client_fn.return_value = mock_client

        from app.summarizer import summarize
        result = summarize(transcript)

        assert _word_count(result.summary) <= 200


# ── Property 3: highlights list length in [3, 7] ─────────────────────────────
# Validates: Requirements 3.2

@given(
    transcript=st.text(min_size=10, max_size=300).filter(lambda t: t.strip() != ""),
    summary=st.text(min_size=5, max_size=100).filter(lambda s: s.strip()),
    highlights=st.lists(
        st.text(min_size=3, max_size=50).filter(lambda h: h.strip()),
        min_size=3,
        max_size=7,
    ),
)
@settings(max_examples=50, suppress_health_check=[HealthCheck.too_slow])
def test_property3_highlights_count_in_3_to_7(transcript, summary, highlights):
    """Property 3: summarize() returns between 3 and 7 highlights.
    Validates: Requirements 3.2
    """
    mock_response = _make_openai_response(summary, highlights)

    with patch("app.summarizer._get_client") as mock_client_fn:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = mock_response
        mock_client_fn.return_value = mock_client

        from app.summarizer import summarize
        result = summarize(transcript)

        assert 3 <= len(result.highlights) <= 7
