"""Resolve current/historical syllabus evidence without an LLM or UI server."""
from __future__ import annotations

from datetime import datetime, timezone
from html.parser import HTMLParser
from io import BytesIO
import time
from urllib.parse import urljoin, urlparse
import zipfile

import requests
from .api import validate_term
from .transport import SourceError

MAX_BYTES = 15 * 1024 * 1024


def prior_terms(term, count=6):
    validate_term(term)
    year, season = int(term[:3]), term[-1]
    result = []
    for _ in range(count):
        if season == '1':
            year, season = year - 1, '7'
        elif season == '4':
            season = '1'
        else:
            season = '4'
        result.append(f'{year:03d}{season}')
    return result


def safe_download_url(url):
    """Only ASU-controlled URLs and its public document hosting providers."""
    if not isinstance(url, str):
        raise SourceError('ASU Syllabus', 'Invalid syllabus download URL.')
    parsed = urlparse(url)
    host = (parsed.hostname or '').lower()
    allowed = (host == 'asu.edu' or host.endswith('.asu.edu') or
               host.endswith('.amazonaws.com') or host == 'docs.google.com')
    if parsed.scheme != 'https' or not allowed or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise SourceError('ASU Syllabus', 'Syllabus download host is unsupported.')
    return url


def download_document(client, url):
    url = safe_download_url(url)
    if urlparse(url).hostname == 'docs.google.com' and '/document/d/' in url:
        doc_id = urlparse(url).path.split('/document/d/', 1)[1].split('/')[0]
        url = f'https://docs.google.com/document/d/{doc_id}/export?format=txt'
    # Do not send ASU catalog headers/authorization to storage providers.
    with requests.Session() as session:
        for _ in range(5):
            safe_download_url(url)
            try:
                with session.get(url, timeout=client.timeout, stream=True, allow_redirects=False) as response:
                    if response.status_code in (301, 302, 303, 307, 308):
                        url = urljoin(url, response.headers.get('Location', ''))
                        continue
                    response.raise_for_status()
                    if int(response.headers.get('Content-Length') or 0) > MAX_BYTES:
                        raise SourceError('ASU Syllabus', 'Syllabus exceeds 15 MiB.', status=413)
                    chunks, size = [], 0
                    for chunk in response.iter_content(65536):
                        size += len(chunk)
                        if size > MAX_BYTES:
                            raise SourceError('ASU Syllabus', 'Syllabus exceeds 15 MiB.', status=413)
                        chunks.append(chunk)
                    return b''.join(chunks), response.headers.get('Content-Type', 'application/octet-stream'), url
            except requests.Timeout:
                raise SourceError('ASU Syllabus', 'Syllabus download timed out.', status=504) from None
            except (requests.RequestException, ValueError):
                raise SourceError('ASU Syllabus', 'Syllabus download failed.') from None
    raise SourceError('ASU Syllabus', 'Too many syllabus redirects.')


class _HTMLText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1
        if tag in ('p', 'br', 'div', 'tr', 'li', 'h1', 'h2', 'h3'):
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip = max(0, self.skip - 1)

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def extract_document_text(content, content_type='', max_chars=100000):
    """Page text for citations; no OCR and no invented workload/assessment facts."""
    pages = []
    try:
        if content.startswith(b'%PDF'):
            from pypdf import PdfReader
            reader = PdfReader(BytesIO(content))
            if len(reader.pages) > 150:
                raise SourceError('ASU Syllabus', 'Document exceeds the 150-page extraction limit.', status=413)
            pages = [{'page': i + 1, 'text': p.extract_text() or ''} for i, p in enumerate(reader.pages)]
            fmt = 'pdf'
        elif content.startswith(b'PK'):
            from docx import Document
            with zipfile.ZipFile(BytesIO(content)) as archive:
                if sum(x.file_size for x in archive.infolist()) > 50 * 1024 * 1024:
                    raise SourceError('ASU Syllabus', 'Expanded document exceeds 50 MiB.', status=413)
            doc = Document(BytesIO(content))
            parts = [p.text for p in doc.paragraphs]
            parts.extend(' | '.join(c.text for c in row.cells) for table in doc.tables for row in table.rows)
            pages = [{'page': None, 'text': '\n'.join(parts)}]
            fmt = 'docx'
        else:
            value = content.decode('utf-8', errors='replace')
            if 'html' in content_type.lower() or value.lstrip().lower().startswith(('<!doctype', '<html')):
                # A JavaScript syllabus viewer is not the actual syllabus.
                if 'syllabus management' in value.lower() and 'static/js/' in value:
                    raise SourceError('ASU Syllabus', 'Upstream returned a viewer instead of a syllabus document.')
                parser = _HTMLText()
                parser.feed(value)
                value = ''.join(parser.parts)
                fmt = 'html'
            elif 'text/' in content_type.lower():
                fmt = 'text'
            else:
                raise SourceError('ASU Syllabus', 'Unsupported syllabus document format.', status=415)
            pages = [{'page': None, 'text': value}]
    except SourceError:
        raise
    except Exception:
        raise SourceError('ASU Syllabus', 'Could not parse syllabus document.', status=422) from None
    chars, output, truncated = 0, [], False
    for page in pages:
        remaining = max_chars - chars
        value = page['text'][:remaining]
        output.append({**page, 'text': value})
        chars += len(value)
        if len(value) < len(page['text']):
            truncated = True
        if chars >= max_chars:
            truncated = truncated or len(output) < len(pages)
            break
    joined = '\n\n'.join(p['text'] for p in output).strip()
    text = joined[:max_chars]
    truncated = truncated or len(joined) > max_chars
    return {'text': text, 'pages': output, 'format': fmt, 'truncated': truncated,
            'extraction_status': 'ok' if text else 'no_extractable_text',
            'ocr_required': fmt == 'pdf' and not text}


def _names(row):
    names = row['CLAS'].get('INSTRUCTORSLIST') or []
    return [names] if isinstance(names, str) else names


def _matches(row, professor):
    wanted = set(professor.casefold().replace(',', ' ').split())
    return any(wanted <= set(name.casefold().replace(',', ' ').split()) for name in _names(row))


def lookup_syllabus(client, *, subject, catalog_nbr, term, professor='', fallback_terms=None,
                    max_pages=2, include_text=True, max_chars=100000, budget_seconds=90):
    """Rank current same professor, historical same professor, then other professors.

    An unavailable source raises an error if no usable document is found; absence is
    distinguished from an outage. Historical evidence is always labeled.
    """
    validate_term(term)
    historical_terms = prior_terms(term) if fallback_terms is None else fallback_terms
    if len(historical_terms) > 9:
        raise ValueError('At most 9 fallback terms are allowed')
    for value in historical_terms:
        validate_term(value)
        if int(value) >= int(term):
            raise ValueError('Fallback terms must precede the requested term')
    terms = list(dict.fromkeys([term, *historical_terms]))
    started = time.monotonic()
    attempts, deferred = [], []
    incomplete, source_failed = False, False

    def try_candidates(rows):
        nonlocal source_failed
        for row in rows:
            if time.monotonic() - started >= budget_seconds:
                return None
            c = row['CLAS']
            try:
                url = safe_download_url(client.get_syllabus_url(c['CLASSNBR'], c.get('STRM') or term))
                extracted = {}
                if include_text:
                    content, content_type, _ = download_document(client, url)
                    extracted = extract_document_text(content, content_type, max_chars)
            except SourceError as exc:
                attempts.append({'term': c.get('STRM'), 'class_nbr': c['CLASSNBR'], 'status': 'unavailable' if exc.status != 404 else 'not_found', 'message': str(exc)})
                source_failed = source_failed or exc.status != 404
                continue
            source_term = str(c.get('STRM') or term)
            same = _matches(row, professor) if professor else None
            historical = source_term != term
            warning = 'Historical syllabus; topics, assessments and grading may change.' if historical else ''
            if same is False:
                warning = (warning + ' Different instructor from the requested professor.').strip()
            return {'status': 'ok', 'requested_term': term, 'source_term': source_term,
                    'requested_professor': professor or None, 'instructors': _names(row),
                    'same_professor': same, 'historical': historical, 'warning': warning or None,
                    'course': f'{subject} {catalog_nbr}', 'class_nbr': str(c['CLASSNBR']),
                    'download_url': url, 'retrieved_at': datetime.now(timezone.utc).isoformat(),
                    'search_complete': not incomplete, 'attempts': attempts, **extracted}
        return None

    for source_term in terms:
        if time.monotonic() - started >= budget_seconds:
            incomplete = True
            break
        try:
            page = client.search_all_classes(term=source_term, subject=subject, catalog_nbr=catalog_nbr, max_pages=max_pages)
        except SourceError as exc:
            source_failed, incomplete = True, True
            attempts.append({'term': source_term, 'status': 'unavailable', 'message': str(exc)})
            continue
        incomplete = incomplete or not page['complete']
        # Guard against broad/prefix responses. Only exact requested courses qualify.
        rows = [r for r in page['classes'] if str(r['CLAS'].get('SUBJECT', '')).upper() == subject.upper()
                and str(r['CLAS'].get('CATALOGNBR', '')).upper().strip() == catalog_nbr.upper()]
        rows.sort(key=lambda r: not bool(r.get('HASSYLLABUS') or r.get('SYLLABUSURL')))
        attempts.append({'term': source_term, 'status': 'searched', 'sections': len(rows), 'complete': page['complete']})
        preferred = [r for r in rows if not professor or _matches(r, professor)]
        deferred.extend(r for r in rows if professor and not _matches(r, professor))
        selected = try_candidates(preferred)
        if selected:
            return selected
    selected = try_candidates(deferred)
    if selected:
        return selected
    exhausted_budget = time.monotonic() - started >= budget_seconds
    return {'status': 'unavailable' if source_failed else ('incomplete' if incomplete or exhausted_budget else 'not_found'),
            'requested_term': term, 'course': f'{subject} {catalog_nbr}', 'download_url': None,
            'search_complete': not (incomplete or exhausted_budget), 'attempts': attempts,
            'retrieved_at': datetime.now(timezone.utc).isoformat(),
            'warning': 'No usable syllabus retrieved; do not infer assignments, grading weights, or workload.'}
