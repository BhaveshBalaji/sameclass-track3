# ASU Class Search API

API-only ASU catalog and syllabus integration. From the parent repository directory:

```bash
pip install -r class_search_api/requirements.txt
python -m uvicorn class_search_api.server:app --port 8000
```

All routes are GET. [OpenAPI contract](openapi.json), runtime docs at `/docs`.

| Route | Required parameters | Response |
| --- | --- | --- |
| `/api/search` | `term` | Normalized `results`, `count`, upstream `total`, `scroll_id`, `pages_fetched`, `complete`, `stop_reason`, `retrieved_at` |
| `/api/search/raw` | `term` | One original ASU page, including `classes`, `aggregations`, `scrollId`, `total` |
| `/api/subjects` | `term` | Original subject response; optional `sl=Y` |
| `/api/courses` | `term`, `subject`, `catalog_nbr` | Full course records under `courses`; optional `course_id` |
| `/api/course_description` | `term`, `subject`, `catalog_nbr` | Description, prerequisite text, complete first course record, retrieval timestamp; optional `course_id` |
| `/api/syllabus_url` | `term`, `class_nbr` | Redirect to public download; use `redirect=false` for JSON |
| `/api/syllabus/document` | `term`, `class_nbr` | Original document as an attachment |
| `/api/syllabus/text` | `term`, `class_nbr` | Extracted text, PDF pages, extraction status, truncation, URL and timestamp |
| `/api/syllabus/lookup` | `term`, `subject`, `catalog_nbr` | Current or historical evidence, optional extracted text, instructor/term provenance and attempts |

## Search filters

`term` is an ASU code: `2271` = Spring 2027, `2267` = Fall 2026; endings `1`, `4`, `7` indicate Spring, Summer, Fall.

Original API filter names are preserved:

| Input | ASU wire key / behavior |
| --- | --- |
| `subject`, `keyword`, `level`, `units`, `college`, `session` | Same name |
| `catalog_nbr` | `catalogNbr`; course number or prefix |
| `instructor` | `instructorName` |
| `days` | `daysOfWeek`; ASU day code/filter syntax |
| `start_date`, `end_date` | `startDate`, `endDate`; `mm/dd/yyyy` |
| `search_type` | `searchType`; `all` or `open` |
| `honors`, `promod` | `T` or `F`; defaults `F` |
| `campus_or_online_selection` | `campusOrOnlineSelection`; default `A`, `O` for ASU Online |
| `location` | Campus code such as `TEMPE`; `ONLINE`/`ASUONLINE` selects `O`; `ICOURSE`/`ASUSYNC` uses a location filter |
| `scroll_id` | `scrollId`; opaque continuation token |
| `max_pages` | Local request cap, default 1, maximum 20 |
| `include_raw` | Include each complete source section alongside normalized data; default false |

Native camelCase keys and additional ASU filters pass through; conflicting aliases return `422`. `/api/search/raw` is the unmodified source response escape hatch. It uses a fixed source URL/path, not a user-supplied URL.

`level=lower` filters to 100/200-level courses; `upper` to 300/400; `grad`/`graduate` and `undergrad`/`undergraduate` map to ASU's native level categories. Numeric prefixes such as `5` and ranges such as `500-599` use the catalog prefix and a local check. ASU ignores some unsupported native filter values, so callers should verify returned rows against their hard constraints. `total` is upstream's count before local filtering; `count` is the returned count. A page can contain no local matches while later pages still contain matches.

Pagination tolerates ASU reusing a scroll ID, but stops when no new sections arrive. Resume with `scroll_id`; do not claim all results were inspected unless `complete` is true. Use `include_raw=true` for source fields beyond the normalized contract. Multiple meeting rows survive in `meeting_intervals`; no missing row is filled from a different meeting. Times use `America/Phoenix`. Missing seats remain `null`, rather than being assumed closed or open.

```bash
curl -G http://localhost:8000/api/search \
  --data-urlencode term=2271 --data-urlencode subject=CSE \
  --data-urlencode catalog_nbr=575 --data-urlencode max_pages=3

curl 'http://localhost:8000/api/course_description?term=2271&subject=CSE&catalog_nbr=575&course_id=125131'
```

## Syllabus access and historical fallback

```bash
curl -G http://localhost:8000/api/syllabus/lookup \
  --data-urlencode term=2271 --data-urlencode subject=CSE \
  --data-urlencode catalog_nbr=575 --data-urlencode 'professor=Yingzhen Yang' \
  --data-urlencode fallback_terms=2267,2264,2261
```

1. Try the requested term and instructor.
2. Try earlier terms with the same instructor, newest first by default.
3. Try other instructors, starting with the requested term, then earlier offerings.

Omit `professor` to accept any instructor. Instructor matching is conservative token matching, not fuzzy identity resolution. Omit `fallback_terms` for the previous six semesters; an empty value disables historical lookup. You can supply up to nine earlier terms, searched in the supplied order. Exact course matching prevents accidentally treating CSE 575A as CSE 575. A missing listing flag does not prevent probing for a public document.

Options: `include_text=true`, `max_chars=100000` (100–500000), `max_pages=2` per term (1–3), `budget_seconds=90` (1–120). Search/time limits are reported; an incomplete scan is not proof that no syllabus exists. `search_complete` refers to pages searched before the selected candidate, not an exhaustive search of every historical offering.

Results retain `requested_term`, `source_term`, `historical`, `same_professor`, `instructors`, `class_nbr`, `download_url`, `retrieved_at`, warnings and attempts. Historical grading weights or assignments must not be presented as upcoming course facts. Text remains evidence for your agent to interpret; the API does not invent workload scores.

Downloads are limited to 15 MiB and trusted ASU/document-provider hosts, with redirects checked at every hop. PDF extraction is capped at 150 pages and DOCX expansion at 50 MiB. PDF pages are numbered; DOCX/HTML/text have `page: null`. Scanned PDFs can return no text and `ocr_required=true`. Download URLs can expire; resolve them again rather than persisting them as permanent links.

## Python use

```python
from class_search_api.api import ASUClassSearchClient
from class_search_api.syllabus import lookup_syllabus

client = ASUClassSearchClient()
try:
    sections = client.search_classes(term='2271', subject='CSE', catalog_nbr='575')
    subjects = client.get_subjects('2271')
    evidence = lookup_syllabus(client, term='2271', subject='CSE', catalog_nbr='575',
                               professor='Yingzhen Yang', fallback_terms=['2267'])
finally:
    client.close()
```
