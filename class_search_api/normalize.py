"""API data stays structured: no HTML anchors or UI formatting."""
import json
from .schedule import meetings
from html import unescape
from urllib.parse import urlencode


def text(value):
    return unescape(str(value if value is not None else '')).strip()


def integer(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def section_url(term, subject, catalog_nbr, class_nbr='', course_id=''):
    params = {'campusOrOnlineSelection': 'A', 'honors': 'F', 'promod': 'F', 'searchType': 'all',
              'subject': subject, 'catalogNbr': catalog_nbr, 'term': term}
    url = 'https://catalog.apps.asu.edu/catalog/classes/classlist?' + urlencode(params)
    if class_nbr and course_id:
        url += '#detailsOpen=' + text(class_nbr) + '-' + text(course_id)
    return url


def normalize_section(raw, term, include_raw=False):
    c, seat = raw['CLAS'], raw.get('seatInfo') or {}
    total = integer(seat.get('ENRL_CAP', c.get('ENRLCAP')))
    enrolled = integer(seat.get('ENRL_TOT', c.get('ENRLTOT')))
    names = c.get('INSTRUCTORSLIST') or []
    if isinstance(names, str):
        names = [names]
    profiles = c.get('INSTRUCTORSLASTNAMELIST') or []
    instructors = []
    for i, name in enumerate(names):
        parts = str(profiles[i]).split('~') if i < len(profiles) else []
        instructors.append({'name': text(name), 'profile_url': 'https://search.asu.edu/profile/' + parts[1] if len(parts) > 1 and parts[1] else None})
    locations = raw.get('LOCATIONBUILDING') or c.get('LOCATIONBUILDING') or []
    if isinstance(locations, str):
        try:
            locations = json.loads(locations)
        except ValueError:
            locations = [{'NAME': locations}]
    if not isinstance(locations, list):
        locations = []
    subject, catalog = text(c.get('SUBJECT')), text(c.get('CATALOGNBR'))
    term = text(c.get('STRM')) or term
    number = text(c.get('CLASSNBR'))
    result = {
        'course': f'{subject} {catalog}', 'subject': subject, 'catalog_nbr': catalog,
        'title': text(c.get('TITLE')), 'number': number, 'class_nbr': number,
        'section': text(c.get('CLASSSECTION')), 'term': term, 'course_id': text(c.get('CRSEID')),
        'instructors': instructors, 'days': c.get('DAYLIST') or '',
        'start': c.get('STARTTIME'), 'end': c.get('ENDTIME'),
        'meeting_intervals': meetings(raw), 'timezone': 'America/Phoenix',
        'meeting_dates': c.get('MEETINGDATES') or [], 'start_date': c.get('STARTDATE'), 'end_date': c.get('ENDDATE'),
        'session': c.get('SESSIONCODE'), 'campus': c.get('CAMPUS'), 'location': c.get('LOCATION'),
        'locations': locations, 'instruction_mode': c.get('INSTRUCTIONMODE'),
        'units_min': c.get('UNITSMINIMUM'), 'units_max': c.get('UNITSMAXIMUM'),
        'units': c.get('UNITSRANGE') or c.get('UNITSMINIMUM'),
        'open_seats': max(0, total - enrolled) if total is not None and enrolled is not None else None,
        'total_seats': total, 'enrolled': enrolled, 'waitlist_total': integer(c.get('WAITTOT')),
        'waitlist_capacity': integer(c.get('WAITCAP')), 'status': c.get('ENRLSTAT'),
        'component': c.get('COMPONENTPRIMARY'), 'associated_class': c.get('ASSOCIATEDCLASS'),
        'college': c.get('DESCR5'), 'department': c.get('DESCR6'),
        'general_studies': {k: raw.get(k) or c.get(k) for k in ('RQMNTDESIGNTN', 'GSGOLD', 'GSMAROON')},
        'notes': c.get('DESCRLONG'), 'has_syllabus': bool(raw.get('HASSYLLABUS') or raw.get('SYLLABUSURL')),
        'syllabus_url': raw.get('SYLLABUSURL'), 'class_url': section_url(term, subject, catalog, number, c.get('CRSEID')),
        'deadlines': {k: c.get(k) for k in ('ENROLLDEADLINE', 'DROPRETAINRECORD', 'DROPWITHPENALTY', 'WITHDRAWWITHPENALTY')},
    }
    if include_raw:
        result['raw'] = raw
    return result
