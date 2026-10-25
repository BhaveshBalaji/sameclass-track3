"""RMP GraphQL client adapted from Class_Helper/rmp_api/rmp.py.

Construction is network-free. A client owns its Session; use one per request/thread.
"""
from __future__ import annotations

import base64
from datetime import datetime, timezone
import time
from .transport import SourceError, make_session, request_json

SERVICE = 'Rate My Professors'
TEACHER_FIELDS = '''id legacyId firstName lastName department avgRating numRatings
                   wouldTakeAgainPercent avgDifficulty'''
REVIEW_FIELDS = '''id comment ratingTags date class helpfulRating clarityRating
    difficultyRating grade attendanceMandatory wouldTakeAgain isForCredit
    isForOnlineClass textbookUse'''


def global_id(value: str, kind: str) -> str:
    value = str(value).strip()
    if value.isdecimal():
        return base64.b64encode(f'{kind}-{value}'.encode()).decode()
    try:
        decoded = base64.b64decode(value, validate=True).decode()
    except (ValueError, UnicodeError):
        raise ValueError(f'Expected a numeric or base64 {kind} ID.') from None
    prefix, separator, number = decoded.partition('-')
    if prefix != kind or not separator or not number.isdecimal():
        raise ValueError(f'Expected a {kind} ID.')
    return value


class RateMyProfessorsAPI:
    graphql_url = 'https://www.ratemyprofessors.com/graphql'

    def __init__(self, timeout=(5, 20), session=None):
        self.timeout = timeout
        self.session = session if session is not None else make_session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json',
            'Referer': 'https://www.ratemyprofessors.com/',
            'Origin': 'https://www.ratemyprofessors.com',
            # Public web-client credential used by the original integration, not a user secret.
            'Authorization': 'Basic dGVzdDp0ZXN0', 'Content-Type': 'application/json',
        })

    def close(self):
        self.session.close()

    def _graphql(self, query, variables):
        result = request_json(self.session, 'POST', self.graphql_url, SERVICE,
                              timeout=self.timeout, json={'query': query, 'variables': variables})
        if not isinstance(result, dict) or not isinstance(result.get('data'), dict):
            raise SourceError(SERVICE, 'Unexpected GraphQL response.')
        return result['data']

    @staticmethod
    def _connection(value, key):
        try:
            edges, page_info = value['edges'], value['pageInfo']
            if not isinstance(edges, list) or not isinstance(page_info.get('hasNextPage'), bool):
                raise TypeError
            nodes = [edge['node'] for edge in edges]
            if not all(isinstance(node, dict) and node.get('id') for node in nodes):
                raise TypeError
            return {key: nodes, 'pageInfo': page_info}
        except (KeyError, TypeError, AttributeError):
            raise SourceError(SERVICE, 'Malformed paginated response.') from None

    def search_school(self, school_name):
        data = self._graphql('''query($query: String!) {
          newSearch { schools(query: {text: $query}) { edges {node {id name city state}} }}
        }''', {'query': school_name})
        try:
            nodes = [edge['node'] for edge in data['newSearch']['schools']['edges']]
            if not all(isinstance(n, dict) and n.get('id') for n in nodes):
                raise TypeError
            return nodes
        except (KeyError, TypeError):
            raise SourceError(SERVICE, 'Malformed school search response.') from None

    def get_professors_page(self, school_id, limit=20, search_text='', cursor='', fallback=False):
        self._check_limit(limit)
        data = self._graphql('''query($count: Int!, $cursor: String, $query: TeacherSearchQuery!) {
          search: newSearch { teachers(query: $query, first: $count, after: $cursor) {
            didFallback edges {node {''' + TEACHER_FIELDS + '''}}
            pageInfo {hasNextPage endCursor}
          }} }''', {'count': limit, 'cursor': cursor or '', 'query': {
              'text': search_text, 'schoolID': global_id(school_id, 'School'), 'fallback': fallback}})
        try:
            connection = data['search']['teachers']
        except (KeyError, TypeError):
            raise SourceError(SERVICE, 'Malformed professor search response.') from None
        result = self._connection(connection, 'professors')
        for node in result['professors']:
            if not node.get('legacyId'):
                raise SourceError(SERVICE, 'Professor response lacks its legacy identifier.')
            node['profile_url'] = f"https://www.ratemyprofessors.com/professor/{node['legacyId']}"
        return {**result, 'didFallback': connection.get('didFallback', False),
                'retrieved_at': datetime.now(timezone.utc).isoformat()}

    def get_professors_by_school_id(self, school_id, limit=20, search_text='', cursor=''):
        return self.get_professors_page(school_id, limit, search_text, cursor)['professors']

    def get_professor(self, teacher_id):
        data = self._graphql('''query($id: ID!) { node(id: $id) { ... on Teacher {
          ''' + TEACHER_FIELDS + ''' school {id name city state}
        }}}''', {'id': global_id(teacher_id, 'Teacher')})
        node = data.get('node')
        if node is None:
            raise SourceError(SERVICE, 'Professor not found.', status=404)
        if not isinstance(node, dict) or not node.get('id') or not node.get('legacyId'):
            raise SourceError(SERVICE, 'Malformed professor response.')
        return {**node, 'profile_url': f"https://www.ratemyprofessors.com/professor/{node['legacyId']}",
                'retrieved_at': datetime.now(timezone.utc).isoformat()}

    def get_professor_reviews(self, teacher_id, limit=20, cursor=''):
        self._check_limit(limit)
        data = self._graphql('''query($id: ID!, $count: Int!, $cursor: String!) {
          node(id: $id) { ... on Teacher {
            id firstName lastName ratings(first: $count, after: $cursor) {
              edges {node {''' + REVIEW_FIELDS + '''}} pageInfo {hasNextPage endCursor}
            }
          }}}''', {'id': global_id(teacher_id, 'Teacher'), 'count': limit, 'cursor': cursor or ''})
        node = data.get('node')
        if node is None:
            raise SourceError(SERVICE, 'Professor not found.', status=404)
        try:
            result = self._connection(node['ratings'], 'reviews')
            legacy = base64.b64decode(global_id(teacher_id, 'Teacher')).decode().split('-')[1]
            return {**result, 'profile_url': f'https://www.ratemyprofessors.com/professor/{legacy}',
                    'retrieved_at': datetime.now(timezone.utc).isoformat()}
        except (KeyError, TypeError):
            raise SourceError(SERVICE, 'Malformed reviews response.') from None

    @staticmethod
    def _check_limit(limit):
        if not 1 <= limit <= 100:
            raise ValueError('page size must be between 1 and 100')

    def _collect(self, fetch, key, *, max_pages=10, cursor='', budget_seconds=60):
        if not 1 <= max_pages <= 100 or not 1 <= budget_seconds <= 120:
            raise ValueError('max_pages must be 1..100 and budget_seconds 1..120')
        initial_cursor = cursor
        items, ids, cursors = [], set(), {cursor}
        started, pages, complete, reason = time.monotonic(), 0, False, 'page_limit'
        page_info = {'hasNextPage': True, 'endCursor': cursor}
        for _ in range(max_pages):
            if pages and time.monotonic() - started >= budget_seconds:
                reason = 'time_budget'
                break
            page = fetch(cursor)
            pages += 1
            fresh = 0
            for item in page[key]:
                if item['id'] not in ids:
                    items.append(item)
                    ids.add(item['id'])
                    fresh += 1
            page_info = page['pageInfo']
            if not page_info['hasNextPage']:
                complete, reason = True, 'exhausted'
                break
            next_cursor = page_info.get('endCursor')
            if not next_cursor or next_cursor in cursors or not fresh:
                reason = 'pagination_stalled'
                break
            cursor = next_cursor
            cursors.add(cursor)
        return {key: items, 'count': len(items), 'pages_fetched': pages, 'complete': complete,
                'stop_reason': reason, 'pageInfo': page_info,
                'start_cursor': initial_cursor,
                'retrieved_at': datetime.now(timezone.utc).isoformat()}

    def collect_professors(self, school_id, search_text='', page_size=20, max_pages=10, cursor='', budget_seconds=60):
        return self._collect(lambda after: self.get_professors_page(school_id, page_size, search_text, after),
                             'professors', max_pages=max_pages, cursor=cursor, budget_seconds=budget_seconds)

    def get_all_professors_by_school_id(self, school_id, search_text='', page_size=20, max_pages=3):
        return self.collect_professors(school_id, search_text, page_size, max_pages)['professors']

    def collect_reviews(self, teacher_id, page_size=20, max_pages=10, cursor='', budget_seconds=60):
        result = self._collect(lambda after: self.get_professor_reviews(teacher_id, page_size, after),
                               'reviews', max_pages=max_pages, cursor=cursor, budget_seconds=budget_seconds)
        legacy = base64.b64decode(global_id(teacher_id, 'Teacher')).decode().split('-')[1]
        return {**result, 'profile_url': f'https://www.ratemyprofessors.com/professor/{legacy}'}
