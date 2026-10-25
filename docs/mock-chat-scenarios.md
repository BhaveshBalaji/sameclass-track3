# Mock chat scenarios for CourseCrew

Prepared as planning/test material. Every student, preference, approval claim and message below is invented. Course codes are research inputs, not assertions that a section exists or that a university approves a requirement. No synthetic course availability or syllabus is a product fallback.

## Base scenario: four students, one silent

Session: `test:spring-planning`; semester Spring 2027 (`2271`); timezone `America/Phoenix`. All four actors explicitly join and accept the processing notice before these messages. Synthetic IDs such as `test:maya` are internal test identities, not Discord account IDs.

| Actor | Synthetic identity | Initial planning role |
| --- | --- | --- |
| Maya | `test:maya` | Database/distributed-systems interests |
| Leo | `test:leo` | Machine-learning/data interests |
| Nina | `test:nina` | Data-systems interests and project preference |
| Dev | `test:dev` | Joined but has not supplied preferences |

### Student messages

| Message ID | Author | Message |
| --- | --- | --- |
| `test:m01` | Maya | “For Spring 2027, I'm looking for one 3-credit elective in Tempe. My approved choices are CSE 511 or CSE 512. I cannot attend before noon on weekdays; all weekday times after noon work. I prefer database or distributed-systems topics and project-based assessment.” |
| `test:m02` | Leo | “Same semester: one 3-credit Tempe elective. My approved choices are CSE 512 or CSE 575. I cannot attend Tuesday or Thursday from 2–6 PM. All other weekday times work. I prefer machine learning/data topics and fewer high-stakes exams.” |
| `test:m03` | Nina | “I need one 3-credit Tempe elective from my list: CSE 511 or CSE 512. I cannot attend Monday or Wednesday after 4 PM; other weekday times work. I prefer mornings and team projects, but mornings are a preference, not a requirement.” |
| `test:m04` | Leo | “Let's compare options after lunch.” |
| `test:m05` | Maya | “@CourseCrew, check our preferences above and find sections we could take together. Give alternatives if one section doesn't work for everyone.” |

`@CourseCrew` is readable notation. The machine fixture must set structured assistant-mention metadata; writing this string alone is not proof of a Discord mention.

### Expected interpretation

| Actor | Hard facts | Soft preferences | Unknowns/limits |
| --- | --- | --- | --- |
| Maya | Spring 2027; 3-credit Tempe elective; stated list CSE 511/512; no weekday meetings before 12:00 | Database/distributed topics; projects | No verified degree audit; actual sections still need research |
| Leo | Same term/credit/campus; stated list CSE 512/575; unavailable Tue/Thu 14:00–18:00 | ML/data topics; fewer high-stakes exams | Course-specific assessment requires actual evidence |
| Nina | Same term/credit/campus; stated list CSE 511/512; unavailable Mon/Wed after 16:00 | Mornings; team projects | Morning preference must not become a hard exclusion |
| Dev | Registered participant only | None stated | Timing, requirements, campus, credits and interests are unknown |

“Approved choices” means **student-supplied approval claim**, not verified university policy. Availability only concerns the dimensions expressed; unusual/weekend meetings still need handling.

### Expected behavior at the first invocation

- Ordinary messages `m01`–`m04` cause no unsolicited reply or per-message model call.
- Extract three separate profiles, preserving author/source references and hard/soft distinctions.
- At Milestone 1, summarize those profiles and explicitly say research is not connected. At Milestone 4, research live options and report fit for the three with sufficient information.
- CSE 512 is on all three stated lists, but the test must not assume a real mutually compatible section exists.
- Ask Dev once whether they want to supply requirements/preferences. Do not treat Dev as unrestricted or repeatedly ping them.
- Report partial recommendation coverage and any unknown facts. Do not claim a complete semester plan.

## Continuation A: explicit flexibility with a requirement

Dev directly replies to the assistant's pending clarification, without mentioning the bot:

> “Anything works for me, any weekday time is fine. I just need my database elective requirement done.”

Expected: update only Dev's weekday timing flexibility and stated requirement. Campus/credits and the approved-course mapping are still unknown. Ask a targeted question if needed: “Which courses are approved for your database elective?” Do not silently assume the other students' lists apply to Dev.

Dev then replies:

> “For my requirement, my approved list is CSE 511 or CSE 512. I also need 3 credits in Tempe.”

Expected: retain that as Dev's own stated rule, update only Dev, and continue the interaction using supported evidence. No separate mention is required for a valid reply to the outstanding question.

## Continuation B: individual course research

Leo sends an actual assistant mention:

> “@CourseCrew, what is CSE 512 about, and what does its syllabus say for our semester? Tell me if the evidence is from an older offering.”

Expected: mention Leo, use the selected session term, retrieve available course/syllabus evidence, and clarify section/instructor when necessary for specific claims. Label historical term/instructor and keep old assessments historical. All four profiles and selected-course preferences remain unchanged.

Later, Leo asks:

> “@CourseCrew, who teaches it, how many seats are open, and which instructor fits my preference for fewer high-stakes exams?”

Expected: research the relevant sections/instructors, timestamp seats, resolve RMP identity, and distinguish syllabus facts from student review themes. If assessments or identities are unavailable, say so rather than promising an easier class.

## Continuation C: corrections and author isolation

Maya sends:

> “Correction: I also cannot do Tuesdays at all. My other preferences stay the same.”

Expected: store the message without unsolicited chatter; apply Maya's correction when the workflow next processes it. Preserve her other fields and every other student's profile. An explicit new invocation can request a refreshed recommendation.

Nina then says:

> “Maya probably wants early mornings now.”

Expected: this does not override Maya's own statement. A profile update requires Maya's statement or explicit confirmation.

## Small controlled variants for targeted tests

| Variant | Change | Assertion |
| --- | --- | --- |
| Duplicate event | Replay one event with the same ID twice | One state effect and no duplicate response |
| Standalone question | A configured-channel user who has not joined asks `/ask` about a course/syllabus | Answer available evidence without adding membership or changing profiles; clarify term if absent |
| Required component conflict | A lecture fits but its required lab conflicts | Reject verified compatibility or mark unresolved component compatibility unchecked |
| Wrong clarification author | Leo replies to the question directed at Dev | No change to Dev's profile from Leo's statement |
| No shared match | Test-only sections violate different students' hard times | Explain conflict and return individual alternatives without relaxing constraints |
| Unknown meeting | A test-only candidate has missing meeting time | Do not label it verified conflict-free |
| Historical syllabus | Exact current section has no document; earlier evidence exists | Show actual source term/instructor and historical applicability |
| Ambiguous instructor | Two plausible RMP candidates | Do not attach an arbitrary candidate's reviews |
| Partial source failure | One worker succeeds and another times out | Retain successful findings and identify missing evidence |
| Outdated request | New profile version or planning message arrives during research | Older result cannot replace newer state or claim to include newer messages |

Add only the controlled evidence required for a variant, inside isolated tests. A small artificial section set is enough to test matching; it is never used by the running bot when live APIs fail.

## Replay implementation and evidence

Milestone 1 converts these scenarios to JSON/events with actor ID, message ID, content, ordered timestamp, structured mentions, reply-to reference, and expected semantic assertions. Replies refer to the generated clarification response rather than a fabricated permanent Discord message ID.

The replay adapter invokes the same application intake/handlers as the Discord adapter, with isolated test/development database storage and a separate synthetic identity namespace. Local replay uses isolated local Postgres storage; automated CI may use disposable test databases. Later hosted live replay uses a separate Supabase schema/project, with the same event contracts and semantic assertions. Development replay can use real model/API calls; automated tests may inject bounded test doubles explicitly. Track these modes in the output so a mocked check cannot be mistaken for a live check.

A single human can separately verify real Discord `/plan start`, joining, mentioning, replying and restarting. Four-person conversation logic is validated through replay, not by impersonating four Discord accounts. If shown inside Discord, the transcript and synthetic actor labels must be marked as simulated, with no real participant pings.

Passing this pack demonstrates functionality on designed scenarios. It does not establish real student demand or replace later feedback from consenting students.

## Later-stage complex-workflow suite

Build this expanded, machine-readable regression pack during Milestone 4, after the basic interaction and research paths work. These are planned cases, not implemented tests. Milestone 1 keeps its smaller baseline pack.

| Scenario family | Multi-step sequence | Required assertions |
| --- | --- | --- |
| Correction during research | Start a group request; one student changes availability while workers run; request a refresh | Earlier results never claim the correction was included or overwrite the newer profile; refreshed results use the right version |
| Join/leave during research | Begin research, then change the session roster | Coverage/mentions use a valid roster snapshot; leaving does not become unrestricted availability |
| Reset and late results | Reset a profile/session while extraction/research is pending; deliver its old result | Removed facts cannot reappear from late results or restored checkpoints; no stale response is presented as current |
| Multiple channels and requests | Interleave two sessions and an individual question | Preferences, evidence applicability, pending replies and responses remain scoped to the correct session/request |
| Clarification plus failure | One source times out while a participant replies to a targeted question | Successful evidence survives; only the intended author's profile updates; missing evidence stays explicit |
| Wrong or duplicate replies | Another student answers a clarification, then the intended student replies; replay the event | No cross-author preference mutation, repeated update or duplicate final reply |
| No shared option after correction | A previously shared option fails a newly stated hard constraint | Explain the changed fit, offer valid individual alternatives and do not quietly relax the constraint |
| Required component recovery | Lecture fits, required lab conflicts; a second valid lab is available or linkage is unknown | Select only a verified valid combination, otherwise label compatibility unchecked; backups follow the same rule |
| Ambiguous professor resolution | Candidate search returns two plausible identities; later evidence resolves one | No arbitrary review attachment before resolution; final findings retain correct identity and course relevance |
| Historical syllabus with changed instructor | Current document is absent; historical evidence has different assessments/instructor | Preserve source term/instructor and distinguish historical context from upcoming course facts |
| Partial pagination and retry | Retrieve review pages, rate-limit/fail a later page, then retry within bounds | Retain unique successful reviews, report partial coverage, respect retry policy and avoid duplicate analysis |
| Cache reuse and expiry | Reuse research across overlapping requests; cached seats expire while syllabus evidence remains fresh | Cache identity/scope is correct, only expired evidence refreshes, reused timestamps remain truthful |
| Worker timeout plus late completion | A worker exceeds its deadline while a sibling succeeds; the timed-out call finishes later | Bounded response uses successful findings, no repeated uncancelled fan-out, and late results do not duplicate delivery |
| Restart and resume | Pause or checkpoint a request; restart; resume or explicitly expire it | Persistent profiles/questions survive; only an authorized current interaction resumes; external messages remain idempotent |
| Unsupported or malicious tool instruction | A document/review requests a profile change or arbitrary network call | Source content stays evidence; only registered tools with validated arguments execute; profiles remain author-scoped |
| Manual question during planning | An unjoined or joined user asks a syllabus/course question while group research runs | Answer only that request's scope without changing the roster/profiles or confusing its reply with a pending clarification |

Use a finite curated pack rather than every combination. Each fixture should specify ordered events, controlled evidence/model outputs, injected delays/errors where relevant, expected state versions, expected participant coverage and forbidden side effects. Test failures should identify the step and invariant rather than compare exact generated prose.

Maintain deterministic replay in isolated test storage, plus a smaller opt-in live-model sample with bounded cost/time and recorded model/provider configuration. Add a regression fixture for each meaningful workflow bug. After deployment, rerun a representative subset against the hosted configuration to verify parity; do not copy real student data into the synthetic pack.
