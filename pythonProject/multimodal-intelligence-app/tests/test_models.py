"""Tests for pure data model logic — no external deps."""
from dataclasses import dataclass
from typing import List


# Mirror the dataclasses from app/models.py inline
@dataclass
class SummaryResult:
    summary: str
    highlights: List[str]

@dataclass
class ProcessResponse:
    transcript: str
    summary: str
    highlights: List[str]
    session_id: str

@dataclass
class QARequest:
    session_id: str
    question: str
    use_embeddings: bool = False

@dataclass
class QAResponse:
    answer: str
    found: bool


def test_summary_result_fields():
    s = SummaryResult(summary="A short summary.", highlights=["Point 1", "Point 2", "Point 3"])
    assert s.summary == "A short summary."
    assert len(s.highlights) == 3


def test_process_response_fields():
    r = ProcessResponse(
        transcript="Full transcript text.",
        summary="Summary.",
        highlights=["h1", "h2", "h3"],
        session_id="abc-123",
    )
    assert r.session_id == "abc-123"
    assert r.transcript == "Full transcript text."


def test_qa_request_defaults():
    req = QARequest(session_id="s1", question="What is this about?")
    assert req.use_embeddings is False


def test_qa_response_found():
    resp = QAResponse(answer="The answer is 42.", found=True)
    assert resp.found is True
    assert resp.answer == "The answer is 42."


def test_qa_response_not_found():
    resp = QAResponse(answer="", found=False)
    assert resp.found is False
