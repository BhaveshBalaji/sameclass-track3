"""Run from the repository root: uvicorn rmp_api.server:app --port 8001."""
from typing import Annotated
from fastapi import Depends, FastAPI, Query, Request
from fastapi.responses import JSONResponse
from .rmp import RateMyProfessorsAPI
from .models import Professor, ProfessorPage, ProfessorCollection, ReviewPage, ReviewCollection
from .transport import install_handlers

app = FastAPI(title='SameClass RMP API', version='1.0.0', description='School, professor, and review research without UI dependencies.')
install_handlers(app)


def get_client():
    client = RateMyProfessorsAPI()
    try:
        yield client
    finally:
        client.close()


Client = Annotated[RateMyProfessorsAPI, Depends(get_client)]
Limit = Annotated[int, Query(ge=1, le=100)]
Cursor = Annotated[str, Query(max_length=4096)]


@app.exception_handler(ValueError)
async def invalid_id(request: Request, exc: ValueError):
    return JSONResponse(status_code=422, content={'detail': str(exc)})


@app.get('/api/schools', tags=['schools'])
def schools(client: Client, q: str = Query(min_length=2, max_length=200)):
    return {'schools': client.search_school(q)}


@app.get('/api/professors', response_model=ProfessorPage, tags=['professors'])
def professors(client: Client, school_id: str = Query(min_length=1, max_length=200),
               q: str = Query('', max_length=200), limit: Limit = 20, cursor: Cursor = '',
               fallback: bool = False):
    """One page. Keep fallback false to prevent matches from other institutions."""
    return client.get_professors_page(school_id, limit, q, cursor, fallback)


@app.get('/api/professors/all', response_model=ProfessorCollection, tags=['professors'])
def all_professors(client: Client, school_id: str = Query(min_length=1, max_length=200),
                   q: str = Query('', max_length=200), page_size: Limit = 20,
                   max_pages: Limit = 10, cursor: Cursor = '',
                   budget_seconds: int = Query(60, ge=1, le=120)):
    return client.collect_professors(school_id, q, page_size, max_pages, cursor, budget_seconds)


@app.get('/api/professors/{prof_id}', response_model=Professor, tags=['professors'])
def professor(prof_id: str, client: Client):
    return client.get_professor(prof_id)


@app.get('/api/professors/{prof_id}/reviews', response_model=ReviewPage, tags=['reviews'])
def reviews(prof_id: str, client: Client, limit: Limit = 20, cursor: Cursor = ''):
    return client.get_professor_reviews(prof_id, limit, cursor)


@app.get('/api/professors/{prof_id}/reviews/all', response_model=ReviewCollection, tags=['reviews'])
def all_reviews(prof_id: str, client: Client, page_size: Limit = 20, max_pages: Limit = 10,
                cursor: Cursor = '', budget_seconds: int = Query(60, ge=1, le=120)):
    """Full review text with explicit retrieval coverage. Resume using endCursor if incomplete."""
    return client.collect_reviews(prof_id, page_size, max_pages, cursor, budget_seconds)
