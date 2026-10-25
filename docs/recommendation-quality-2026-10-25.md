# Recommendation quality check — October 25, 2026

This scheduled run focused on search, evidence retrieval and response quality. Milestone 5 deployment remains incomplete. All student identities were synthetic; no Discord messages were sent and the running bot was not restarted.

## Changes

- Catalog cache keys now distinguish every query dimension, preventing concurrent subject-only or keyword-filtered requests from sharing unrelated results.
- A research shortlist no longer discards other time-compatible candidates needed to fill separate student requests. One bounded follow-up batch fetches newly selected sections using the same source budget and deadline. Failed sections are not repeatedly retried.
- Data mining is included in AI/ML discovery. When an official description explicitly mentions matching topics, including classification/clustering, deterministic topic support adds two soft-fit points once per student/section. Model paraphrases cannot double-count the same positive topic support. This does not prove a light workload.
- Each student sees their own preferences, class count, meeting times, explicit reasons and separate caveats. The group summary names a common course or explicitly identifies partial-group coverage. Unsupported interest/workload fit stays unverified; long caveats end with an ellipsis at a word boundary.
- The live check can now run through actual application start/join/message/command/extraction/delivery in isolated test Postgres, instead of constructing profiles directly. It asserts that the two-course/one-course requests are filled, that course/term identity is correct, and that work blocks, before-5-PM availability and class conflicts are respected. It cleans up its synthetic session/checkpoints.

## Evidence

The general/research suite passed 31 tests, planning-state suite passed 10 tests, and affected group/discovery/recommendation suite passed 27 tests. TypeScript compilation passed. Controlled cases cover source failure, correction and author isolation, no shared match, silent participants, unknown meetings/components, concurrent query cache isolation and preservation of alternatives outside a research shortlist. These controlled tests are not live-provider reliability measurements.

Four bounded live runs inspected real model/catalog/syllabus/review results: a baseline, two intermediate iterations, and a final check after improving topic support. The final run used the actual application intake with isolated test storage, made four model calls, took about 25.2 seconds including intake, and produced two courses for Student A and one for Student B. The earlier runs exposed unresearched alternatives being favored after evidence reranking and weak AI/ML topic explanations. Retrieval and ranking improved, but the fixed budget can still leave candidates without full evidence.

The final live check selected CSE 572 (Data Mining, section 22535) as a shared preliminary course. Student A also received CSE 540 (section 29722), with an explicit high-difficulty caveat. This is a bounded schedule proposal, not proof these are globally best or easy courses. A subsequent display-only change separated caveats and removed unverified soft time preferences from the Why line; its affected offline checks were rerun without another paid call.

## Readable excerpt from the final live response

**Student A — 2/2 courses suggested**

- CSE 540, section 29722: Monday/Wednesday 3–4:15 PM. Fits known attendance limits; interest/workload fit remains unverified. Professor difficulty was 4/5 across courses, so this is a workload tradeoff rather than a verified easy choice.
- CSE 572, section 22535: Monday/Wednesday noon–1:15 PM. Fits hard work exclusions but overlaps the preferred noon–2 PM lunch break.

**Student B — 1/1 course suggested**

- CSE 572, section 22535: Monday/Wednesday noon–1:15 PM, before the 5 PM boundary. The agent explained: “Official description includes ‘classification’, matching your AI/ML interest.”

**Overall:** CSE 572 was the best common course in this selected plan. Both students can attend its published meetings; Student A has a lunch-preference tradeoff, while Student B has positive AI/ML topic evidence. Neither student's easy-workload preference was verified.

## Remaining gaps and next run

- Current-offering syllabus evidence was unavailable for the selected courses; Fall 2026 evidence was labeled historical. CSE 572's fallback also had a different instructor.
- The retrieved CSE 572 professor evidence had zero course-specific reviews; aggregate ratings were general instructor context only. No easy-course guarantee is supported.
- Required lab/recitation rules and degree/prerequisite eligibility remain unchecked. No live Discord layout/mention or deployment verification occurred.
- The final allocator can select a previously unresearched candidate after the single follow-up batch. Such source gaps remain explicit. Next work should improve evidence coverage for final choices without unbounded fetching, and improve Student A's workload fit rather than merely filling counts.
- Native Postgres 17 was used temporarily on loopback port 55439 because the Docker image pull did not finish. Test data was isolated; no production/session database was used. Temporary API/test database processes were stopped after checks.

To repeat with an existing isolated test database and running local APIs:

```sh
RAY_RECOMMENDATION_INTAKE=true RAY_TEST_DATABASE_URL=<isolated-test-postgres-url> RAY_RECOMMENDATION_PREVIEW=/absolute/path/preview.md npm run check:recommendation --workspace bot
```

The exact redacted output from the final live run is saved locally under `.local/recommendation-quality-2026-10-25.txt`; it contains synthetic identities and live source observations, with signed document links removed.
