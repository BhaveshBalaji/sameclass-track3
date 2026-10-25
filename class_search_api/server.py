"""Run from repository root: uvicorn class_search_api.server:app --port 8000."""
from datetime import datetime, timezone
from typing import Annotated, Literal
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response
from .api import ASUClassSearchClient
from .models import SearchResponse, SyllabusResult
from .normalize import normalize_section
from .syllabus import download_document, extract_document_text, lookup_syllabus, safe_download_url
from .transport import install_handlers

app = FastAPI(title='SameClass ASU Class Search API', version='1.0.0',
              description='Live catalog, sections, descriptions, prerequisites, and syllabus evidence.')
install_handlers(app)


def get_client():
    client = ASUClassSearchClient()
    try:
        yield client
    finally:
        client.close()


Client = Annotated[ASUClassSearchClient, Depends(get_client)]
Term = Annotated[str, Query(pattern=r'^\d{3}[147]$')]
Subject = Annotated[str, Query(pattern=r'^[A-Za-z]{2,5}$')]
Catalog = Annotated[str, Query(pattern=r'^\d{1,3}[A-Za-z]?$')]
ClassNumber = Annotated[str, Query(pattern=r'^\d{1,6}$')]
MaxPages = Annotated[int, Query(ge=1, le=20)]
Level = Literal['', 'lower', 'upper', 'grad', 'graduate', 'undergrad', 'undergraduate',
                '1', '2', '3', '4', '5', '6', '7', '8', '9',
                '100-199', '200-299', '300-399', '400-499', '500-599',
                '600-699', '700-799', '800-899', '900-999']


@app.exception_handler(ValueError)
async def invalid_value(request: Request, exc: ValueError):
    return JSONResponse(status_code=422, content={'detail': str(exc)})


ALIASES = {'keyword': 'keywords', 'catalog_nbr': 'catalogNbr', 'instructor': 'instructorName', 'days': 'daysOfWeek',
           'start_date': 'startDate', 'end_date': 'endDate', 'search_type': 'searchType',
           'scroll_id': 'scrollId', 'campus_or_online_selection': 'campusOrOnlineSelection'}
LOCAL = {'max_pages', 'include_raw', 'location'}


def search_params(request):
    params = {}
    # Unknown ASU query keys pass through on the raw route; the URL and path stay fixed.
    for key, value in request.query_params.multi_items():
        if key in LOCAL or not value:
            continue
        mapped = ALIASES.get(key, key)
        if mapped in params and params[mapped] != value:
            raise HTTPException(422, f'Conflicting or repeated parameter: {mapped}')
        params[mapped] = value
    location = request.query_params.get('location')
    if location:
        if location.upper() in ('ONLINE', 'ASUONLINE'):
            params['campusOrOnlineSelection'] = 'O'
        elif location.upper() in ('ICOURSE', 'ASUSYNC'):
            params['location'] = location.upper()
        else:
            params['campus'] = location.upper()
    # Client keyword names are distinct from ASU wire names.
    for internal, wire in {'catalog_nbr': 'catalogNbr', 'search_type': 'searchType',
                           'campus_or_online_selection': 'campusOrOnlineSelection'}.items():
        if wire in params:
            params[internal] = params.pop(wire)
    if params.get('subject'):
        params['subject'] = params['subject'].upper()
    for key, choices in {'search_type': ('all', 'open'), 'campus_or_online_selection': ('A', 'O'),
                         'honors': ('T', 'F'), 'promod': ('T', 'F')}.items():
        if key in params and params[key] not in choices:
            raise HTTPException(422, f'Invalid value for {key}')
    level = params.get('level', '')
    if level in ('lower', 'upper', 'undergraduate'):
        params['level'] = 'undergrad'
    elif level == 'graduate':
        params['level'] = 'grad'
    elif level in tuple('123456789') or (len(level) == 7 and level[0] in '123456789' and level[1:] == f'00-{level[0]}99'):
        params.pop('level')
        params.setdefault('catalog_nbr', level[0])
    return params


@app.get('/api/subjects', tags=['catalog'])
def subjects(term: Term, client: Client, sl: str = Query('Y', pattern='^[YN]$')):
    return client.get_subjects(term, sl)


@app.get('/api/search', tags=['catalog'], response_model=SearchResponse)
def search(request: Request, term: Term, client: Client,
           subject: str = Query('', max_length=5), catalog_nbr: str = Query('', max_length=4),
           keyword: str = Query('', max_length=200), instructor: str = Query('', max_length=200),
           level: Level = '', units: str = Query('', max_length=20),
           college: str = Query('', max_length=30), location: str = Query('', max_length=30),
           session: str = Query('', max_length=20), days: str = Query('', max_length=100),
           start_date: str = Query('', max_length=10), end_date: str = Query('', max_length=10),
           search_type: Literal['all', 'open'] = 'all', honors: Literal['T', 'F'] = 'F',
           campus_or_online_selection: Literal['A', 'O'] = 'A', promod: Literal['T', 'F'] = 'F',
           scroll_id: str = Query('', max_length=16384), max_pages: MaxPages = 1, include_raw: bool = False):
    """Normalized sections. ASU native camelCase filter names also pass through.

    max_pages bounds upstream requests. total is the upstream count before local
    lower/upper filters; count is the returned count. Missing seat data stays null.
    """
    params = search_params(request)
    data = client.search_all_classes(max_pages=max_pages, **params)
    rows = [normalize_section(r, term, include_raw) for r in data['classes']]
    if level in ('lower', 'upper'):
        ranges = ('1', '2') if level == 'lower' else ('3', '4')
        rows = [r for r in rows if r['catalog_nbr'].startswith(ranges)]
    elif level and level[0] in '123456789':
        rows = [r for r in rows if r['catalog_nbr'].startswith(level[0])]
    result = {k: v for k, v in data.items() if k not in ('classes', 'scrollId')}
    return {**result, 'count': len(rows), 'results': rows, 'scroll_id': data['scrollId'],
            'retrieved_at': datetime.now(timezone.utc).isoformat()}


@app.get('/api/search/raw', tags=['catalog'])
def search_raw(request: Request, term: Term, client: Client):
    """One unmodified upstream page, including aggregations and all source fields.

    Accepts native ASU filters in addition to the aliases on /api/search.
    """
    return client.search_classes(**search_params(request))


@app.get('/api/courses', tags=['catalog'])
def courses(term: Term, subject: Subject, catalog_nbr: Catalog, client: Client,
            course_id: str = Query('', pattern=r'^\d*$')):
    """Complete upstream course records, including prerequisites and college maps."""
    return {'courses': client.get_courses(term, subject.upper(), catalog_nbr.upper(), course_id)}


@app.get('/api/course_description', tags=['catalog'])
def course_description(term: Term, subject: Subject, catalog_nbr: Catalog, client: Client,
                       course_id: str = Query('', pattern=r'^\d*$')):
    data = client.get_courses(term, subject.upper(), catalog_nbr.upper(), course_id)
    if not data:
        raise HTTPException(404, 'Course not found.')
    course = data[0]
    maps = course.get('COLLEGEMAP') or []
    prereqs = [entry.get('INFO', {}).get('ENROLLREQ') for entry in maps if isinstance(entry, dict)]
    return {'description': course.get('DESCRLONG'), 'prerequisites': next((p for p in prereqs if p), None),
            'course': course, 'retrieved_at': datetime.now(timezone.utc).isoformat()}


@app.get('/api/syllabus_url', tags=['syllabus'])
def syllabus_url(class_nbr: ClassNumber, term: Term, client: Client, redirect: bool = True):
    """Original redirect endpoint; redirect=false returns JSON for tool/agent clients."""
    url = safe_download_url(client.get_syllabus_url(class_nbr, term))
    if redirect:
        return RedirectResponse(url, status_code=307, headers={'Cache-Control': 'no-store'})
    return {'download_url': url, 'class_nbr': class_nbr, 'term': term}


@app.get('/api/syllabus/document', tags=['syllabus'])
def syllabus_document(class_nbr: ClassNumber, term: Term, client: Client):
    url = client.get_syllabus_url(class_nbr, term)
    content, content_type, _ = download_document(client, url)
    # Attachment + nosniff avoids executing HTML served by third-party sources.
    return Response(content, media_type=content_type, headers={
        'Content-Disposition': f'attachment; filename="syllabus-{term}-{class_nbr}"',
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store'})


@app.get('/api/syllabus/text', tags=['syllabus'])
def syllabus_text(class_nbr: ClassNumber, term: Term, client: Client,
                  max_chars: int = Query(100000, ge=100, le=500000)):
    url = client.get_syllabus_url(class_nbr, term)
    content, content_type, _ = download_document(client, url)
    return {'class_nbr': class_nbr, 'source_term': term, 'download_url': url,
            'retrieved_at': datetime.now(timezone.utc).isoformat(),
            **extract_document_text(content, content_type, max_chars)}


@app.get('/api/syllabus/lookup', tags=['syllabus'], response_model=SyllabusResult)
def syllabus_lookup(term: Term, subject: Subject, catalog_nbr: Catalog, client: Client,
                    professor: str = Query('', max_length=200), fallback_terms: str | None = Query(None, max_length=60),
                    max_pages: int = Query(2, ge=1, le=3), include_text: bool = True,
                    max_chars: int = Query(100000, ge=100, le=500000),
                    budget_seconds: int = Query(90, ge=1, le=120)):
    """Current syllabus, older same instructor, then other instructors.

    Omit fallback_terms for six prior semesters, or supply comma-separated term
    codes; an empty string disables historical lookup. Every fallback is labeled.
    """
    terms = None if fallback_terms is None else [v.strip() for v in fallback_terms.split(',') if v.strip()]
    return lookup_syllabus(client, term=term, subject=subject.upper(), catalog_nbr=catalog_nbr.upper(),
                           professor=professor, fallback_terms=terms, max_pages=max_pages,
                           include_text=include_text, max_chars=max_chars, budget_seconds=budget_seconds)
