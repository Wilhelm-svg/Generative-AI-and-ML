"""Property tests for QA engine — tasks 5.3 (Property 4) and 5.4 (Property 5).
Mocks the OpenAI/Groq client to avoid real API calls.
"""
# Feature: multimodal-intelligence-app, Property 4
# Feature: multimodal-intelligence-app, Property 5

from unittest.mock import patch, MagicMock, call

from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st

from app.models import QAResponse


# ── helpers ───────────────────────────────────────────────────────────────────

def _make_openai_response(text: str) -> MagicMock:
    mock_message = MagicMock()
    mock_message.content = text
    mock_choice = MagicMock()
    mock_choice.message = mock_message
    mock_response = MagicMock()
    mock_response.choices = [mock_choice]
    return mock_response


_nonempty_text = st.text(
    alphabet=st.characters(blacklist_categories=("Cs",)),
    min_size=1,
    max_size=200,
).filter(lambda t: t.strip() != "")


# ── Property 4: answer() never raises and always returns a QAResponse ─────────
# Validates: Requirements 4.2, 4.4

@given(
    question=_nonempty_text,
    transcript=_nonempty_text,
    llm_reply=_nonempty_text,
)
@settings(max_examples=50, suppress_health_check=[HealthCheck.too_slow])
def test_property4_answer_never_raises(question, transcript, llm_reply):
    """Property 4: answer() never raises and always returns a QAResponse.
    Validates: Requirements 4.2, 4.4
    """
    mock_response = _make_openai_response(llm_reply)

    with patch("app.qa._get_client") as mock_client_fn:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = mock_response
        mock_client_fn.return_value = mock_client

        from app.qa import answer
        result = answer(question=question, transcript=transcript, use_embeddings=False)

        assert isinstance(result, QAResponse)
        assert isinstance(result.answer, str)
        assert isinstance(result.found, bool)


@given(
    question=st.just(""),
    transcript=_nonempty_text,
)
@settings(max_examples=10, suppress_health_check=[HealthCheck.too_slow])
def test_property4_empty_question_returns_not_found(question, transcript):
    """Property 4 edge case: empty question returns found=False without raising.
    Validates: Requirements 4.4
    """
    from app.qa import answer
    result = answer(question=question, transcript=transcript)
    assert isinstance(result, QAResponse)
    assert result.found is False


# ── Property 5: vector search is invoked when use_embeddings=True ─────────────
# Validates: Requirements 4.3

@given(
    question=_nonempty_text,
    transcript=st.text(min_size=20, max_size=500).filter(lambda t: t.strip() != ""),
    llm_reply=_nonempty_text,
)
@settings(max_examples=30, suppress_health_check=[HealthCheck.too_slow])
def test_property5_vector_search_invoked_when_use_embeddings_true(
    question, transcript, llm_reply
):
    """Property 5: _vector_search (embed) is called when use_embeddings=True.
    Validates: Requirements 4.3
    """
    mock_response = _make_openai_response(llm_reply)

    with patch("app.qa._get_client") as mock_client_fn, \
         patch("app.qa._vector_search", wraps=None) as mock_vector_search:

        mock_vector_search.return_value = ["chunk1", "chunk2"]
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = mock_response
        mock_client_fn.return_value = mock_client

        from app.qa import answer
        result = answer(question=question, transcript=transcript, use_embeddings=True)

        # _vector_search must have been called exactly once
        mock_vector_search.assert_called_once()
        assert isinstance(result, QAResponse)


@given(
    question=_nonempty_text,
    transcript=st.text(min_size=20, max_size=500).filter(lambda t: t.strip() != ""),
    llm_reply=_nonempty_text,
)
@settings(max_examples=30, suppress_health_check=[HealthCheck.too_slow])
def test_property5_vector_search_not_invoked_when_use_embeddings_false(
    question, transcript, llm_reply
):
    """Property 5 complement: _vector_search is NOT called when use_embeddings=False.
    Validates: Requirements 4.3
    """
    mock_response = _make_openai_response(llm_reply)

    with patch("app.qa._get_client") as mock_client_fn, \
         patch("app.qa._vector_search") as mock_vector_search:

        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = mock_response
        mock_client_fn.return_value = mock_client

        from app.qa import answer
        answer(question=question, transcript=transcript, use_embeddings=False)

        mock_vector_search.assert_not_called()
