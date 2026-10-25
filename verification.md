# Verification

Verified locally on **October 24, 2026 (America/Phoenix)** using Python 3.14.7. CI is configured for Python 3.11, 3.12 and 3.13; those CI runs are separate from the local results recorded here.

## Offline checks

- `pytest -q`: **49 passed**. Covers filter translation, multiple meeting rows, unknown seats, correct ASU section links, bounded/repeated pagination, review deduplication, GraphQL/transport failures, ID validation, current versus historical syllabus ordering, absent versus incomplete/unavailable evidence, PDF/DOCX/HTML/text extraction, truncation, download-host restrictions, redirects, endpoint contracts and sample responses.
- `ruff check .`: passed.
- `git diff --check`: passed before commit.
- Checked-in OpenAPI documents match the apps; synthetic examples validate against the response models.

The installed Starlette TestClient emits a deprecation notice for its current `httpx` adapter; all checks pass. Exact installed dependencies are recorded in `requirements-lock.txt`.

## Live smoke checks

Command: `python scripts/smoke_test.py` after installing development requirements. Tests the HTTP routes through FastAPI TestClient with real upstream ASU/RMP requests; no dependency mocks.

| Check | Observed result |
| --- | --- |
| Spring 2027 CSE 575 (`2271`) | Two sections; search complete; raw and normalized section IDs agree |
| Subjects + CSE 575 course description | Both returned successfully |
| Syllabus lookup for Yingzhen Yang | Spring 2027 document absent; found Fall 2026 (`2267`) class `65678`, same instructor; `historical=true` |
| Historical syllabus extraction | PDF parsed; 8,000-character output cap respected, truncation indicated |
| Direct syllabus access | Redirect returned; document route downloaded a PDF attachment |
| RMP school search | Eight Arizona State University school candidates |
| RMP instructor search | Eighteen candidates for the broad name search; exact Yingzhen Yang record selected and school confirmed as ASU Tempe |
| Full review pagination | Sixteen unique reviews across four five-item pages; `complete=true` |

The name search result count demonstrates why the coordinator must confirm identity rather than using the first arbitrary candidate. Live results can change after this check. No full review text, signed download URL, or syllabus document is committed.

## Additional live finding

ASU accepts but ignores unsupported numeric `level` values such as `5`. The normalized API translates numeric/range levels into a catalog prefix, and applies explicit local lower/upper-division checks. Native/raw filter callers must still validate their hard constraints against returned data.
