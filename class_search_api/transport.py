"""Bounded upstream requests; failures never masquerade as empty search results."""
from __future__ import annotations

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


class SourceError(RuntimeError):
    def __init__(self, service: str, message: str, *, status: int = 502, upstream_status: int | None = None):
        super().__init__(message)
        self.service, self.status, self.upstream_status = service, status, upstream_status


def make_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(total=2, backoff_factor=0.3, status_forcelist=[429, 502, 503, 504],
                  allowed_methods=frozenset(['GET', 'POST']), respect_retry_after_header=False, raise_on_status=False)
    session.mount('https://', HTTPAdapter(max_retries=retry))
    return session


def request_json(session, method, url, service, timeout=(5, 20), **kwargs):
    try:
        response = session.request(method, url, timeout=timeout, **kwargs)
        response.raise_for_status()
        data = response.json()
    except requests.Timeout:
        raise SourceError(service, 'Upstream request timed out.', status=504) from None
    except requests.RequestException as exc:
        upstream = getattr(getattr(exc, 'response', None), 'status_code', None)
        status = 503 if upstream == 429 else 502
        raise SourceError(service, 'Upstream request failed.', status=status, upstream_status=upstream) from None
    except ValueError:
        raise SourceError(service, 'Upstream returned invalid JSON.') from None
    if isinstance(data, dict) and (data.get('errors') or data.get('error')):
        raise SourceError(service, 'Upstream returned an API error.')
    return data


def install_handlers(app):
    from fastapi.responses import JSONResponse
    from fastapi.exceptions import ResponseValidationError

    @app.exception_handler(ResponseValidationError)
    async def malformed_source_handler(request, exc):
        return JSONResponse(status_code=502, content={'error': {
            'service': app.title, 'message': 'Upstream data did not match the API response contract.',
            'upstream_status': None}})

    @app.exception_handler(SourceError)
    async def source_error_handler(request, exc):
        return JSONResponse(status_code=exc.status, content={'error': {
            'service': exc.service, 'message': str(exc), 'upstream_status': exc.upstream_status}})

    @app.get('/health', tags=['service'])
    def health():
        return {'status': 'ok', 'service': app.title, 'version': app.version}

    # Cross-origin browser clients opt in explicitly; server-to-server calls need no CORS.
    import os
    from fastapi.middleware.cors import CORSMiddleware
    origins = [v.strip() for v in os.getenv('CORS_ORIGINS', '').split(',') if v.strip()]
    if origins:
        app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False,
                           allow_methods=['GET'], allow_headers=['Accept', 'Content-Type'])
