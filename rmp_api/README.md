# Rate My Professors API

API-only school, professor and review research. From the parent repository directory:

```bash
pip install -r rmp_api/requirements.txt
python -m uvicorn rmp_api.server:app --port 8001
```

All routes are GET. [OpenAPI contract](openapi.json), runtime docs at `/docs`.

| Route | Parameters | Response |
| --- | --- | --- |
| `/api/schools` | `q` (2–200 chars) | `schools` with ID, name, city, state |
| `/api/professors` | `school_id`, optional `q`, `limit=20`, `cursor`, `fallback=false` | `professors`, `pageInfo`, `didFallback`, retrieval timestamp |
| `/api/professors/all` | `school_id`, optional `q`, `page_size=20`, `max_pages=10`, `cursor`, `budget_seconds=60` | Deduplicated professors and coverage metadata |
| `/api/professors/{prof_id}` | Numeric or base64 teacher ID | Rating summary, department, school identity, profile URL and timestamp |
| `/api/professors/{prof_id}/reviews` | Optional `limit=20`, `cursor` | Full review page, profile URL and timestamp |
| `/api/professors/{prof_id}/reviews/all` | Optional `page_size=20`, `max_pages=10`, `cursor`, `budget_seconds=60` | Deduplicated full review text and coverage metadata |

`limit`/`page_size` and `max_pages` accept 1–100. `budget_seconds` accepts 1–120. Budgets stop between upstream calls. Sessions are created per HTTP request and closed afterward; importing this module does not access the network.

## IDs and professor matching

Numeric IDs and RMP GraphQL global IDs are accepted. ASU Tempe is `15723` or `U2Nob29sLTE1NzIz`. Teacher `2519121` is `VGVhY2hlci0yNTE5MTIx`. A school ID passed as a teacher ID is rejected with `422`.

Search returns candidates rather than declaring an identity match. Check name, school and department before associating reviews with an ASU section. RMP can return partial name matches even with `fallback=false`. School fallback is disabled by default; if explicitly enabled, inspect `didFallback` and verify institution through the professor-detail route.

```bash
curl -G http://localhost:8001/api/schools --data-urlencode 'q=Arizona State University'
curl -G http://localhost:8001/api/professors \
  --data-urlencode school_id=15723 --data-urlencode 'q=Yingzhen Yang'
curl http://localhost:8001/api/professors/2519121
curl 'http://localhost:8001/api/professors/2519121/reviews/all?page_size=20&max_pages=10'
```

## Evidence and pagination

Professor records include average rating/difficulty, number of ratings, would-take-again percentage and profile URL. Values are preserved from RMP: for example `wouldTakeAgainPercent=-1` is a source sentinel, not a negative student approval rate.

Reviews retain `id`, `comment`, `ratingTags`, `date`, `class`, `helpfulRating`, `clarityRating`, `difficultyRating`, `grade`, `attendanceMandatory`, `wouldTakeAgain`, `isForCredit`, `isForOnlineClass`, and `textbookUse`. The API does not summarize away comments or assert that review opinions establish course facts. Use the original `class` label to select course-relevant evidence in your coordinator.

Single-page routes expose `pageInfo.hasNextPage` and `pageInfo.endCursor`. Bulk routes add:

```json
{
  "count": 16,
  "pages_fetched": 1,
  "complete": true,
  "stop_reason": "exhausted",
  "start_cursor": "",
  "pageInfo": {"hasNextPage": false, "endCursor": "opaque-token"},
  "retrieved_at": "2026-10-25T02:00:00+00:00"
}
```

`stop_reason` is `exhausted`, `page_limit`, `time_budget`, or `pagination_stalled`. `complete=true` means the source exhausted pages from `start_cursor`. If false, retain the results and resume with `pageInfo.endCursor`, then deduplicate IDs across requests. A stalled cursor cannot guarantee forward progress; retry later rather than looping indefinitely. Transport/GraphQL failures return an HTTP error, not a partial successful bulk response.

## Python use

```python
from rmp_api.rmp import RateMyProfessorsAPI

client = RateMyProfessorsAPI()
try:
    schools = client.search_school('Arizona State University')
    professors = client.get_professors_page('15723', search_text='Yingzhen Yang')
    reviews = client.collect_reviews('2519121', page_size=20, max_pages=10)
finally:
    client.close()
```

Original Python methods are retained: `search_school`, `get_professors_by_school_id`, `get_professors_page`, `get_all_professors_by_school_id`, `get_professor_reviews`. Prefer `collect_professors`/`collect_reviews` when coverage matters: legacy list-only methods cannot express incomplete retrieval. Each client owns a Session; do not share it across threads.
