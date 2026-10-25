"""ASU catalog client adapted from Class_Helper/class_search_api/api.py."""
from __future__ import annotations

import re
from .transport import SourceError, make_session, request_json

SERVICE = 'ASU Class Search'


def validate_term(term):
    if not re.fullmatch(r'\d{3}[147]', str(term)):
        raise ValueError('term must be an ASU four-digit term code ending in 1 (Spring), 4 (Summer), or 7 (Fall)')
    return str(term)


class ASUClassSearchClient:
    BASE_URL = 'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1'

    def __init__(self, timeout=(5, 20), session=None):
        self.timeout = timeout
        self.session = session if session is not None else make_session()
        self.session.headers.update({
            'Accept': 'application/json', 'Accept-Language': 'en-US,en;q=0.9',
            'Authorization': 'Bearer null', 'Origin': 'https://catalog.apps.asu.edu',
            'Referer': 'https://catalog.apps.asu.edu/', 'User-Agent': 'Mozilla/5.0',
        })

    def close(self):
        self.session.close()

    def _get(self, path, params):
        return request_json(self.session, 'GET', f'{self.BASE_URL}/{path}', SERVICE,
                            timeout=self.timeout, params=params)

    def search_classes(self, term, subject=None, catalog_nbr=None, campus_or_online_selection='A',
                       honors='F', promod='F', search_type='all', refine='Y', **extra_params):
        params = {'term': validate_term(term), 'campusOrOnlineSelection': campus_or_online_selection,
                  'honors': honors, 'promod': promod, 'searchType': search_type, 'refine': refine}
        if subject:
            params['subject'] = subject
        if catalog_nbr:
            params['catalogNbr'] = catalog_nbr
        params.update(extra_params)
        data = self._get('search/classes', params)
        if not isinstance(data, dict) or not isinstance(data.get('classes'), list):
            raise SourceError(SERVICE, 'Unexpected class search response.')
        if not all(isinstance(r, dict) and isinstance(r.get('CLAS'), dict) and r['CLAS'].get('CLASSNBR') for r in data['classes']):
            raise SourceError(SERVICE, 'Malformed section response.')
        return data

    def search_all_classes(self, *, max_pages=3, **params):
        if not 1 <= max_pages <= 20:
            raise ValueError('max_pages must be between 1 and 20')
        rows, seen, pages, complete = [], set(), 0, False
        total, scroll_id, reason = {}, params.pop('scrollId', None), 'page_limit'
        resuming = bool(scroll_id)
        for _ in range(max_pages):
            query = {**params}
            if scroll_id:
                query['scrollId'] = scroll_id
            data = self.search_classes(**query)
            pages += 1
            total = data.get('total', {})
            page, fresh = data['classes'], 0
            for row in page:
                key = (str(row['CLAS'].get('STRM', params['term'])), str(row['CLAS']['CLASSNBR']))
                if key not in seen:
                    seen.add(key)
                    rows.append(row)
                    fresh += 1
            scroll_id = data.get('scrollId')
            total_value = total.get('value') if isinstance(total, dict) else total
            exact = not isinstance(total, dict) or total.get('relation') == 'eq'
            if not page or (exact and isinstance(total_value, int) and len(rows) >= total_value and not resuming):
                complete, reason = True, 'exhausted'
                break
            # Elasticsearch can legitimately reuse a scroll ID across fresh pages.
            if not scroll_id or not fresh:
                reason = 'pagination_stalled'
                break
        return {'classes': rows, 'total': total, 'scrollId': scroll_id, 'pages_fetched': pages,
                'complete': complete, 'stop_reason': reason}

    def get_subjects(self, term, sl='Y'):
        data = self._get('search/subjects', {'term': validate_term(term), 'sl': sl})
        if not isinstance(data, (list, dict)):
            raise SourceError(SERVICE, 'Unexpected subjects response.')
        return data

    def get_courses(self, term, subject, catalog_nbr, course_id='', **extra_params):
        params = {'term': validate_term(term), 'subject': subject, 'catalogNbr': catalog_nbr, 'refine': 'Y', **extra_params}
        if course_id:
            params['course_id'] = course_id
        data = self._get('search/courses', params)
        if not isinstance(data, list) or not all(isinstance(c, dict) for c in data):
            raise SourceError(SERVICE, 'Unexpected course detail response.')
        return data

    def get_syllabus_url(self, class_nbr, term):
        try:
            data = request_json(self.session, 'GET', 'https://syllabus-api.apps.asu.edu/get-download-url',
                                'ASU Syllabus', timeout=self.timeout,
                                params={'classNumber': str(class_nbr), 'strm': validate_term(term)})
        except SourceError as exc:
            if exc.upstream_status == 404:
                raise SourceError('ASU Syllabus', 'No public syllabus available for this section.', status=404) from None
            raise
        if not isinstance(data, dict):
            raise SourceError('ASU Syllabus', 'Unexpected syllabus response.')
        url = data.get('downloadUrl')
        if not url and data.get('status') not in (None, 'READY'):
            raise SourceError('ASU Syllabus', 'Syllabus is not ready for download.', status=503)
        if not url:
            raise SourceError('ASU Syllabus', 'No public syllabus available for this section.', status=404)
        return url
