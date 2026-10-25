"""Opt-in live integration checks. No review text or signed URLs are persisted."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from class_search_api.server import app as class_app
from rmp_api.server import app as rmp_app


def checked(http, path, **params):
    response = http.get(path, params=params)
    if response.status_code != 200:
        raise RuntimeError(f'{path}: HTTP {response.status_code}: {response.text[:200]}')
    return response.json()


def main():
    with TestClient(class_app) as http:
        assert checked(http, '/health')['status'] == 'ok'
        data = checked(http, '/api/search', term='2271', subject='CSE', catalog_nbr='575', max_pages=3, include_raw=True)
        assert data['count'] and data['complete']
        first = data['results'][0]
        assert first['raw']['CLAS']['CLASSNBR'] == first['class_nbr']
        print('ASU search:', data['count'], 'sections;', 'complete:', data['complete'])
        checked(http, '/api/subjects', term='2271')
        course = checked(http, '/api/course_description', term='2271', subject='CSE', catalog_nbr='575', course_id=first['course_id'])
        assert course['description']
        print('ASU subjects/course detail: ok')
        syllabus = checked(http, '/api/syllabus/lookup', term='2271', subject='CSE', catalog_nbr='575',
                           professor='Yingzhen Yang', fallback_terms='2267', max_chars=8000)
        assert syllabus['status'] == 'ok' and syllabus['text']
        assert syllabus['source_term'] in ('2271', '2267')
        assert len(syllabus['text']) <= 8000
        print('Syllabus:', syllabus['source_term'], syllabus['format'], 'historical:', syllabus['historical'],
              'text chars:', len(syllabus['text']))
        redirect = http.get('/api/syllabus_url', params={'term': syllabus['source_term'], 'class_nbr': syllabus['class_nbr']}, follow_redirects=False)
        assert redirect.status_code == 307
        doc = http.get('/api/syllabus/document', params={'term': syllabus['source_term'], 'class_nbr': syllabus['class_nbr']})
        assert doc.status_code == 200 and doc.content.startswith(b'%PDF')
        print('Syllabus redirect and PDF attachment: ok')
    with TestClient(rmp_app) as http:
        assert checked(http, '/health')['status'] == 'ok'
        schools = checked(http, '/api/schools', q='Arizona State University')['schools']
        school = next(s for s in schools if s['city'] == 'Tempe')
        data = checked(http, '/api/professors', school_id=school['id'], q='Yingzhen Yang')
        professor = next(p for p in data['professors'] if p['firstName'] == 'Yingzhen' and p['lastName'] == 'Yang')
        detail = checked(http, '/api/professors/' + professor['id'])
        assert detail['school']['id'] == school['id']
        reviews = checked(http, f"/api/professors/{professor['id']}/reviews/all", page_size=5, max_pages=20)
        assert reviews['reviews'] and reviews['complete']
        assert len({r['id'] for r in reviews['reviews']}) == reviews['count']
        print('RMP:', len(schools), 'schools;', len(data['professors']), 'professor candidates;',
              reviews['count'], 'reviews across', reviews['pages_fetched'], 'pages; complete:', reviews['complete'])
    print('Live HTTP-route smoke checks passed.')


if __name__ == '__main__':
    main()
