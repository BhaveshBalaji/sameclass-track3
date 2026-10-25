from unittest.mock import Mock
import pytest
import requests
from rmp_api.rmp import RateMyProfessorsAPI, global_id
from rmp_api.transport import SourceError, request_json


def test_constructor_is_offline_and_ids_are_normalized():
    session = Mock()
    api = RateMyProfessorsAPI(session=session)
    session.request.assert_not_called()
    assert global_id('15723', 'School') == 'U2Nob29sLTE1NzIz'
    with pytest.raises(ValueError):
        global_id('U2Nob29sLTE1NzIz', 'Teacher')
    api.close()
    session.close.assert_called_once()


def test_school_filter_never_falls_back_silently():
    api = RateMyProfessorsAPI()
    api._graphql = Mock(return_value={'search': {'teachers': {
        'edges': [], 'pageInfo': {'hasNextPage': False, 'endCursor': ''}, 'didFallback': False}}})
    assert api.get_professors_page('15723')['professors'] == []
    variables = api._graphql.call_args.args[1]
    assert variables['query']['fallback'] is False
    assert variables['query']['schoolID'] == 'U2Nob29sLTE1NzIz'
    api.close()


def test_bulk_reviews_dedupe_report_completion_and_resume():
    api = RateMyProfessorsAPI()
    api.get_professor_reviews = Mock(side_effect=[
        {'reviews': [{'id': 'a'}, {'id': 'b'}], 'pageInfo': {'hasNextPage': True, 'endCursor': 'next'}},
        {'reviews': [{'id': 'b'}, {'id': 'c'}], 'pageInfo': {'hasNextPage': False, 'endCursor': 'last'}}])
    result = api.collect_reviews('1', max_pages=2)
    assert [r['id'] for r in result['reviews']] == ['a', 'b', 'c']
    assert result['complete'] and result['pages_fetched'] == 2
    assert api.get_professor_reviews.call_args.args[-1] == 'next'
    api.close()


@pytest.mark.parametrize('reason,second', [
    ('pagination_stalled', {'reviews': [{'id': 'a'}], 'pageInfo': {'hasNextPage': True, 'endCursor': 'same'}}),
    ('exhausted', {'reviews': [], 'pageInfo': {'hasNextPage': False, 'endCursor': ''}})])
def test_bulk_stalled_cursor_and_empty_last_page(reason, second):
    api = RateMyProfessorsAPI()
    api.get_professor_reviews = Mock(side_effect=[
        {'reviews': [{'id': 'a'}], 'pageInfo': {'hasNextPage': True, 'endCursor': 'same'}}, second])
    result = api.collect_reviews('1')
    assert result['stop_reason'] == reason
    assert result['complete'] == (reason == 'exhausted')
    api.close()


def test_bulk_page_cap_is_not_claimed_complete():
    api = RateMyProfessorsAPI()
    api.get_professor_reviews = Mock(return_value={'reviews': [{'id': 'a'}],
        'pageInfo': {'hasNextPage': True, 'endCursor': 'next'}})
    result = api.collect_reviews('1', max_pages=1)
    assert not result['complete'] and result['stop_reason'] == 'page_limit'
    assert result['pageInfo']['endCursor'] == 'next'
    api.close()


def test_graphql_errors_and_null_teacher_are_distinct():
    session = Mock()
    session.request.return_value.json.return_value = {'errors': [{'message': 'private upstream text'}], 'data': None}
    api = RateMyProfessorsAPI(session=session)
    with pytest.raises(SourceError, match='API error'):
        api.search_school('ASU')
    session.request.return_value.json.return_value = {'data': {'node': None}}
    with pytest.raises(SourceError) as exc:
        api.get_professor_reviews('1')
    assert exc.value.status == 404


@pytest.mark.parametrize('failure,expected', [(requests.Timeout(), 504), (requests.ConnectionError(), 502)])
def test_transport_errors_are_safe(failure, expected):
    session = Mock()
    session.request.side_effect = failure
    with pytest.raises(SourceError) as exc:
        request_json(session, 'GET', 'https://example.com', 'test')
    assert exc.value.status == expected


def test_routes_page_and_all_are_not_shadowed(rmp_http):
    http, client = rmp_http
    client.collect_professors.return_value = {'professors': [], 'complete': True, 'count': 0, 'pages_fetched': 1, 'stop_reason': 'exhausted', 'pageInfo': {'hasNextPage': False}, 'start_cursor': '', 'retrieved_at': 'now'}
    assert http.get('/api/professors/all', params={'school_id': '15723'}).json()['complete']
    client.get_professor.assert_not_called()
    client.get_professor_reviews.return_value = {'reviews': [], 'pageInfo': {'hasNextPage': False}, 'profile_url': 'https://www.ratemyprofessors.com/professor/1', 'retrieved_at': 'now'}
    assert http.get('/api/professors/1/reviews').status_code == 200
    assert http.get('/api/professors', params={'school_id': '15723', 'limit': 101}).status_code == 422
    assert http.get('/api/schools?q=a').status_code == 422


def test_errors_are_http_failures(rmp_http):
    http, client = rmp_http
    client.search_school.side_effect = SourceError('RMP', 'Upstream unavailable.', upstream_status=403)
    result = http.get('/api/schools?q=ASU')
    assert result.status_code == 502
    assert result.json()['error']['upstream_status'] == 403
    client.get_professor.side_effect = ValueError('Expected a Teacher ID.')
    assert http.get('/api/professors/wrong').status_code == 422


def test_rate_limit_status_and_malformed_payload_are_not_empty_results():
    session = Mock()
    response = requests.Response()
    response.status_code = 429
    session.request.return_value.raise_for_status.side_effect = requests.HTTPError(response=response)
    with pytest.raises(SourceError) as exc:
        request_json(session, 'GET', 'https://example.com', 'test')
    assert exc.value.status == 503 and exc.value.upstream_status == 429
    session.request.return_value.raise_for_status.side_effect = None
    session.request.return_value.json.side_effect = ValueError('raw upstream body')
    with pytest.raises(SourceError, match='invalid JSON'):
        request_json(session, 'GET', 'https://example.com', 'test')
    with pytest.raises(SourceError):
        RateMyProfessorsAPI._connection({'edges': None}, 'reviews')
