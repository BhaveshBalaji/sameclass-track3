from unittest.mock import Mock
import pytest
from fastapi.testclient import TestClient
from class_search_api.server import app as class_app, get_client as class_dependency
from rmp_api.server import app as rmp_app, get_client as rmp_dependency


@pytest.fixture
def asu_http():
    fake = Mock()
    class_app.dependency_overrides[class_dependency] = lambda: fake
    with TestClient(class_app) as http:
        yield http, fake
    class_app.dependency_overrides.clear()


@pytest.fixture
def rmp_http():
    fake = Mock()
    rmp_app.dependency_overrides[rmp_dependency] = lambda: fake
    with TestClient(rmp_app) as http:
        yield http, fake
    rmp_app.dependency_overrides.clear()


def section(number='1', term='2271', professor='Ada Lovelace', catalog='575', **extra):
    return {'CLAS': {'CLASSNBR': number, 'STRM': term, 'SUBJECT': 'CSE', 'CATALOGNBR': catalog,
                     'CRSEID': '125131', 'INSTRUCTORSLIST': [professor], **extra}, 'HASSYLLABUS': True}
