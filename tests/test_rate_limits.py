import importlib

import pytest
import requests
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.mark.parametrize('module', ['class_search_api.transport', 'rmp_api.transport'])
def test_rate_limit_preserves_retry_guidance_through_http_boundary(module):
    transport = importlib.import_module(module)
    response = requests.Response()
    response.status_code = 429
    response.headers['Retry-After'] = '7'

    class Session:
        def request(self, *args, **kwargs):
            return response

    app = FastAPI()
    transport.install_handlers(app)

    @app.get('/limited')
    def limited():
        return transport.request_json(Session(), 'GET', 'https://source.test', 'test')

    result = TestClient(app).get('/limited')
    assert result.status_code == 503
    assert result.headers['Retry-After'] == '7'
    assert result.json()['error']['upstream_status'] == 429


@pytest.mark.parametrize('module', ['class_search_api.transport', 'rmp_api.transport'])
def test_unavailable_source_retains_retry_after(module):
    transport = importlib.import_module(module)
    response = requests.Response()
    response.status_code = 503
    response.headers['Retry-After'] = '11'

    class Session:
        def request(self, *args, **kwargs):
            return response

    with pytest.raises(transport.SourceError) as caught:
        transport.request_json(Session(), 'GET', 'https://source.test', 'test')
    assert caught.value.status == 503
    assert caught.value.retry_after == '11'
