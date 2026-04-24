from dataclasses import dataclass, field


@dataclass
class SummaryResult:
    summary: str          # ≤200 words
    highlights: list[str] # 3–7 items


@dataclass
class ProcessResponse:
    transcript: str
    summary: str
    highlights: list[str]
    session_id: str


@dataclass
class QARequest:
    session_id: str
    question: str
    use_embeddings: bool = False


@dataclass
class QAResponse:
    answer: str   # empty string signals "not found"
    found: bool
