"""Stable envelopes; source records keep their original additional fields."""
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field


class OpenRecord(BaseModel):
    model_config = ConfigDict(extra='allow')


class Meeting(BaseModel):
    days: list[str]
    start: str | None
    end: str | None
    start_date: str | None
    end_date: str | None
    status: Literal['scheduled', 'unknown']


class Section(OpenRecord):
    course: str
    subject: str
    catalog_nbr: str
    class_nbr: str
    course_id: str
    term: str
    title: str
    instructors: list[dict[str, Any]]
    meeting_intervals: list[Meeting]
    timezone: str
    open_seats: int | None
    total_seats: int | None
    class_url: str
    has_syllabus: bool
    syllabus_url: str | None


class SearchResponse(BaseModel):
    count: int
    total: dict[str, Any] | int
    results: list[Section]
    scroll_id: str | None
    pages_fetched: int
    complete: bool
    stop_reason: str
    retrieved_at: str


class SyllabusResult(OpenRecord):
    status: Literal['ok', 'not_found', 'incomplete', 'unavailable']
    requested_term: str
    course: str
    download_url: str | None
    search_complete: bool
    attempts: list[dict[str, Any]]
    retrieved_at: str
    source_term: str | None = None
    historical: bool | None = None
    same_professor: bool | None = None
    warning: str | None = None
    text: str | None = None
    pages: list[dict[str, Any]] = Field(default_factory=list)
    truncated: bool = False
    extraction_status: str | None = None
