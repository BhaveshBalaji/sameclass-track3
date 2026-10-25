# Mock chat scenarios for SameSection

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
| `test:m05` | Maya | “@SameSection, check our preferences above and find sections we could take together. Give alternatives if one section doesn't work for everyone.” |

`@SameSection` is readable notation. The machine fixture must set structured assistant-mention metadata; writing this string alone is not proof of a Discord mention.

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

> “@SameSection, what is CSE 512 about, and what does its syllabus say for our semester? Tell me if the evidence is from an older offering.”

Expected: mention Leo, use the selected session term, retrieve available course/syllabus evidence, and clarify section/instructor when necessary for specific claims. Label historical term/instructor and keep old assessments historical. All four profiles and selected-course preferences remain unchanged.

Later, Leo asks:

> “@SameSection, who teaches it, how many seats are open, and which instructor fits my preference for fewer high-stakes exams?”

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

The replay adapter invokes the same application intake/handlers as the Discord adapter, with a separate temporary database. Development replay can use real model/API calls; automated tests may inject bounded test doubles explicitly. Track these modes in the output so a mocked check cannot be mistaken for a live check.

A single human can separately verify real Discord `/plan start`, joining, mentioning, replying and restarting. Four-person conversation logic is validated through replay, not by impersonating four Discord accounts. If shown inside Discord, the transcript and synthetic actor labels must be marked as simulated, with no real participant pings.

Passing this pack demonstrates functionality on designed scenarios. It does not establish real student demand or replace later feedback from consenting students.
