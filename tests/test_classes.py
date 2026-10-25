from unittest.mock import Mock
from urllib.parse import parse_qs, urlparse
import pytest
from class_search_api.api import ASUClassSearchClient
from class_search_api.normalize import normalize_section
from conftest import section


def test_native_filters_and_aliases_asu_http(asu_http):
    http, client = asu_http
    client.search_all_classes.return_value = {'classes': [section()], 'total': {'value': 1},
        'scrollId': 'next', 'complete': True, 'stop_reason': 'exhausted', 'pages_fetched': 1}
    result = http.get('/api/search', params={'term': '2271', 'subject': 'cse', 'catalog_nbr': '575',
        'instructor': 'Ada', 'days': 'MON', 'start_date': '01/01/2027', 'location': 'ONLINE',
        'keyword': 'AI', 'session': 'C', 'units': '3', 'college': 'ES', 'honors': 'T', 'max_pages': 2})
    assert result.status_code == 200
    query = client.search_all_classes.call_args.kwargs
    assert query['catalog_nbr'] == '575' and query['instructorName'] == 'Ada'
    assert query['daysOfWeek'] == 'MON' and query['startDate'] == '01/01/2027'
    assert query['campus_or_online_selection'] == 'O'
    assert query['max_pages'] == 2 and query['subject'] == 'CSE'
    assert isinstance(result.json()['results'][0]['instructors'], list)


def test_unknown_seats_stay_unknown_and_source_url_uses_course_id():
    result = normalize_section(section(), '2271')
    assert result['open_seats'] is None and result['total_seats'] is None
    parsed = urlparse(result['class_url'])
    assert parse_qs(parsed.query)['term'] == ['2271']
    assert parsed.fragment == 'detailsOpen=1-125131'
    result = normalize_section({**section(), 'seatInfo': {'ENRL_CAP': '100', 'ENRL_TOT': '105'}}, '2271')
    assert result['open_seats'] == 0


def test_upper_division_excludes_grad_courses(asu_http):
    http, client = asu_http
    client.search_all_classes.return_value = {'classes': [section(catalog=n) for n in ['100', '200', '300', '400', '500']],
        'scrollId': None, 'total': 5, 'complete': True, 'pages_fetched': 1, 'stop_reason': 'exhausted'}
    result = http.get('/api/search?term=2271&level=upper').json()
    assert [x['catalog_nbr'] for x in result['results']] == ['300', '400']
    assert client.search_all_classes.call_args.kwargs['level'] == 'undergrad'


def test_scroll_id_can_repeat_with_fresh_results():
    client = ASUClassSearchClient()
    client.search_classes = Mock(side_effect=[
        {'classes': [section('1')], 'total': {'value': 2, 'relation': 'eq'}, 'scrollId': 'same'},
        {'classes': [section('2')], 'total': {'value': 2, 'relation': 'eq'}, 'scrollId': 'same'}])
    result = client.search_all_classes(term='2271', max_pages=2)
    assert result['complete'] and len(result['classes']) == 2
    assert client.search_classes.call_args.kwargs['scrollId'] == 'same'
    client.close()


def test_repeated_class_page_stops_incomplete():
    client = ASUClassSearchClient()
    client.search_classes = Mock(return_value={'classes': [section('1')], 'total': {'value': 100, 'relation': 'eq'}, 'scrollId': 'same'})
    result = client.search_all_classes(term='2271', max_pages=3)
    assert result['pages_fetched'] == 2
    assert not result['complete'] and result['stop_reason'] == 'pagination_stalled'
    client.close()


def test_raw_search_preserves_native_fields(asu_http):
    http, client = asu_http
    client.search_classes.return_value = {'classes': [], 'aggregations': {'campus': ['TEMPE']}}
    result = http.get('/api/search/raw?term=2271&catalogNbr=575&gen_studies=HU')
    assert result.json()['aggregations']['campus'] == ['TEMPE']
    assert client.search_classes.call_args.kwargs['gen_studies'] == 'HU'
    assert client.search_classes.call_args.kwargs['catalog_nbr'] == '575'


@pytest.mark.parametrize('query', ['term=wrong', 'term=2272', 'term=2271&max_pages=21',
    'term=2271&search_type=invalid', 'term=2271&catalog_nbr=575&catalogNbr=510'])
def test_invalid_search_input(asu_http, query):
    http, _ = asu_http
    assert http.get('/api/search?' + query).status_code == 422


def test_course_details_and_absence(asu_http):
    http, client = asu_http
    client.get_courses.return_value = [{'DESCRLONG': 'AI', 'COLLEGEMAP': [{'INFO': {'ENROLLREQ': 'CSE 310'}}]}]
    result = http.get('/api/course_description?term=2271&subject=CSE&catalog_nbr=575')
    assert result.json()['prerequisites'] == 'CSE 310'
    client.get_courses.return_value = []
    assert http.get('/api/course_description?term=2271&subject=CSE&catalog_nbr=575').status_code == 404


def test_service_schema_and_health_are_offline(asu_http, rmp_http):
    for http, fake in (asu_http, rmp_http):
        assert http.get('/health').json()['status'] == 'ok'
        assert http.get('/openapi.json').status_code == 200
        assert http.get('/docs').status_code == 200
        fake.assert_not_called()


def test_all_meeting_rows_survive_and_missing_values_are_unknown():
    raw = section(STARTTIMES=['9:00 AM', '2:00 PM'], ENDTIMES=['10:00 AM', '3:00 PM'],
                  MEETINGDATES=[['1/11/2027', '4/30/2027'], ['1/12/2027', '4/29/2027']])
    raw['DAYLIST'] = ['M W', 'T Th']
    result = normalize_section(raw, '2271')
    first, second = result['meeting_intervals']
    assert first['days'] == ['MON', 'WED'] and second['days'] == ['TUE', 'THU']
    assert second['start'] == '14:00' and second['status'] == 'scheduled'
    raw['DAYLIST'] = ['M W']
    assert normalize_section(raw, '2271')['meeting_intervals'][1]['status'] == 'unknown'


def test_numeric_level_becomes_supported_catalog_prefix(asu_http):
    http, client = asu_http
    client.search_all_classes.return_value = {'classes': [section()], 'total': 1, 'scrollId': None, 'complete': True, 'pages_fetched': 1, 'stop_reason': 'exhausted'}
    assert http.get('/api/search?term=2271&level=5').status_code == 200
    query = client.search_all_classes.call_args.kwargs
    assert query['catalog_nbr'] == '5' and 'level' not in query


def test_checked_in_contracts_match_the_apps():
    import json
    from pathlib import Path
    from class_search_api.server import app as asu
    from rmp_api.server import app as rmp
    from class_search_api.models import SearchResponse
    from rmp_api.models import ProfessorPage
    for folder, app, model in [('class_search_api', asu, SearchResponse), ('rmp_api', rmp, ProfessorPage)]:
        root = Path(__file__).resolve().parents[1] / folder
        assert json.loads((root / 'openapi.json').read_text()) == app.openapi()
        example = json.loads((root / 'example_response.json').read_text())
        assert 'SYNTHETIC' in example.pop('_note')
        model.model_validate(example)


@pytest.mark.parametrize('query', ['term=2271&level=not-a-level', 'term=2271&searchType=invalid'])
def test_normalized_filter_values_are_validated(asu_http, query):
    http, _ = asu_http
    assert http.get('/api/search?' + query).status_code == 422
