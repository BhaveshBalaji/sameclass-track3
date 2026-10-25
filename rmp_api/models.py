from typing import Any
from pydantic import BaseModel, ConfigDict


class PageInfo(BaseModel):
    hasNextPage: bool
    endCursor: str | None = None


class Professor(BaseModel):
    model_config = ConfigDict(extra='allow')
    id: str
    legacyId: int
    firstName: str
    lastName: str
    department: str | None
    avgRating: float | None
    avgDifficulty: float | None
    numRatings: int
    wouldTakeAgainPercent: float | None
    profile_url: str


class ProfessorPage(BaseModel):
    professors: list[Professor]
    pageInfo: PageInfo
    didFallback: bool
    retrieved_at: str


class ReviewPage(BaseModel):
    reviews: list[dict[str, Any]]
    pageInfo: PageInfo
    profile_url: str
    retrieved_at: str


class BulkMetadata(BaseModel):
    count: int
    pages_fetched: int
    complete: bool
    stop_reason: str
    pageInfo: PageInfo
    start_cursor: str
    retrieved_at: str


class ProfessorCollection(BulkMetadata):
    professors: list[Professor]


class ReviewCollection(BulkMetadata):
    reviews: list[dict[str, Any]]
    profile_url: str
