# Integration validation

Reviewed October 24, 2026 (America/Phoenix), against [commit ad226d4](https://github.com/BhaveshBalaji/sameclass-track3/commit/ad226d4f73a4a9b3d30993f2e39de5767249dd7d).

## Repository state

Both integrations are committed on `origin/main`. The local branch has no commits and contains untracked planning documents. The review fetched the remote commit and tested an isolated archive with Python 3.12.6 and the committed dependency constraints. It did not check out or rewrite the API files or overwrite local notes.

## Checks rerun in this review

- `pytest -q`: **49 passed, 1 warning**. The warning concerns Starlette TestClient's deprecated httpx adapter.
- `ruff check .`: passed.
- `python -u scripts/smoke_test.py`: passed against real upstream sources through the FastAPI HTTP routes, with no dependency mocks.
- Live ASU: Spring 2027 (`2271`) CSE 575 returned two sections with complete search coverage for that query; normalized and raw section identity agreed. Subjects and course description succeeded.
- Live syllabus: the smoke scenario retrieved Fall 2026 (`2267`) PDF evidence for the same instructor and extracted 8,000 characters with the configured cap. The syllabus redirect and document download passed. This demonstrates historical evidence retrieval, not verified upcoming assessment requirements.
- Live RMP: eight school candidates, eighteen professor-search candidates, and sixteen unique reviews over four pages; the smoke script selected Yingzhen Yang by exact name and checked the school identity. This is scripted identity verification for one case, not a general automatic identity resolver.

These checks validate one live course/instructor scenario and the existing automated suite. They do not establish universal coverage, bot functionality, degree eligibility, or recommendation quality. No syllabus documents, signed download URLs, or raw review comments were saved as review artifacts.

## Verified capabilities

| Integration | Available evidence |
| --- | --- |
| ASU catalog | Live section search, term/section/course identity, structured instructors, credits/campus, multiple meeting intervals, timezone, nullable derived seats, source links, retrieval timestamps, and bounded pagination/coverage |
| Course detail | Course records, description, textual prerequisites; no degree audit |
| Syllabi | Exact term/section document and text routes; broader instructor-aware current/historical lookup; PDF/DOCX/HTML/text, PDF page references, provenance, truncation and OCR-required flags |
| RMP | School and professor candidate search, professor details and school identity, rating summaries/sample size, full dated reviews with raw course labels, paginated/deduplicated retrieval, and coverage metadata |

The services require no student password or model key. `CORS_ORIGINS` is optional. They have no application authentication; the proposed bot should call them through its private backend boundary.

## Design implications and gaps

1. **Preserve retrieval code.** Proposed boundary: Discord and coordination in TypeScript, typed HTTP adapters to the existing Python services, SQLite for bot state. This awaits the user's architectural decision.
2. **Exact syllabus scope.** A syllabus worker scoped to a selected section should first use `/api/syllabus/text` with its exact term and class number. Broad `/api/syllabus/lookup` searches by course/term/professor name and can select another section. Label every fallback by the actual source offering.
3. **Identity resolution.** RMP search returns candidates, including partial name matches. Confirm name, school and department before treating reviews as an instructor's evidence; unresolved ambiguity must remain visible. Syllabus instructor token matching is not a global identity resolver.
4. **Review relevance.** Raw RMP `class` labels need course-relevance handling. Separate course-specific evidence from broader teaching themes, preserve dates and sample sizes, and interpret sentinels such as `wouldTakeAgainPercent=-1` as missing information.
5. **Compatibility.** Missing meetings remain unknown. Seats are derived observations, not eligibility or reservations. Prerequisite text does not establish that a student satisfies it. Lecture/lab bundle compatibility is not implemented.
6. **Rate limits and deadlines.** Both transports explicitly set `respect_retry_after_header=False`, contrary to the brief's rate-limit guidance. Time budgets are checked between operations and may be exceeded by an in-flight request/retry. Avoid multiplying adapter retries with coordinator retries; total task deadlines and concurrency limits remain application responsibilities.
7. **Partial evidence.** Bounded pagination returns coverage when it stops normally, but a later bulk-page failure raises an error and discards prior accumulated pages from the returned result. The application must preserve independent successful work; page-wise retrieval or an explicit partial-result adapter change is needed if within-task partial evidence is required.
8. **Extraction limits.** No OCR is implemented. Scanned PDFs may remain unavailable for text analysis. Historical syllabus assessments remain historical, and expiring download links must be resolved again.

## Validity conclusion

The data foundation is sufficient to proceed with designing the standalone Track 3 assistant and implementing Milestone 1. The catalog path needed for Milestone 2 exists. The research workers, identity handling, deterministic matching, group state, evidence synthesis, caching, and scheduler still need implementation and validation. A real student planning trial is still needed to test product value.
