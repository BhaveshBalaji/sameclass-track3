# Ray: next Discord features

Research and brainstorm · October 25, 2026 · Proposals, not implemented functionality.

## Branch baseline

Fetched origin and fast-forwarded local `demo-2` from `b1dafb7` to `12479c3`, bringing in nine commits from `origin/demo` without conflicts. No remote push was performed. Existing untracked `social/` work was left untouched.

Reviewed commands, Discord intake, planning application, persistent research context, research orchestration, tests and milestone notes at that revision. The scope below distinguishes source inspection from current live verification.

## What exists

| Area | Implemented behavior observed in source |
| --- | --- |
| Discord interface | `/ping`, `/ask`, `/plan start/status/profile/reset-profile/reset-session`; semester autocomplete; join/leave buttons; replies and native typing indicator |
| Planning | Explicit participation/notice, up to 12 separate student profiles, hard/soft preferences, author-owned corrections, silent-student clarification, bounded ordinary-message retention without per-message inference |
| Research | ASU catalog/details/syllabus and RMP research; catalog discovery can fan out into professor comparisons; bounded parallel retrieval and a second evidence-driven retrieval batch |
| Follow-ups | Six recent research exchanges per user/channel; reply-to-answer context; course/semester/instructor carryover; individual research does not change group profiles |
| Evidence | Code-constructed source destinations; historical syllabus labels; RMP identity/coverage checks; partial results; source caches and refresh |
| Persistence/reliability | Postgres sessions/profiles, research reply associations, event deduplication, response outbox, reset controls, request/version checks and bounded calls |

Important gaps: group planning currently extracts and summarizes profiles; it does not compute a verified shared schedule or rank sections against every member. The research planner explicitly says compatibility checking is unavailable. There are no implemented shortlists, student votes, decision records, reminders, seat watchers, calendar exports or study-session planners. Intake currently accepts configured guild text channels, not threads or DMs.

Milestone notes record earlier live verification of milestones 0–2. Milestone 3 is implemented, with its newest Discord smoke check pending. Those historical checks were not rerun as part of this source review. Deployment remains later work.

Current local verification after import: installed the locked dependencies using the bundled Node 24 runtime; TypeScript build passed. `npm test` passed 26 of 28 tests. One test could not connect to local Postgres on port 55432; Docker's daemon is also unavailable. The other test's expected syllabus request sequence omits the now-implemented `/api/syllabus_url` refresh request (`bot/tests/research.test.ts:58` versus `bot/src/research/sources.ts:104`). This is a stale test expectation found in the imported baseline; no production code or tests were changed during the brainstorm. No live model/API/Discord test was run. Community research through DevRelay was attempted but returned an account-not-connected error; no community claims are used here.

## What Sparky suggests

Reference revision: `14cc07c8f753b8d672016a468b86402c2d452614`. Reviewed README, architecture/roadmap and concrete Discord source files; did not run it.

- **Focused conversations:** its [routing code](https://github.com/theaisocietyasu/sparky/blob/14cc07c8f753b8d672016a468b86402c2d452614/apps/discord/src/access/route.rs) distinguishes DMs, opening channel requests and thread replies. Ray could give each planning topic a thread, after adding thread-aware intake and state.
- **Visible memory controls:** its [commands](https://github.com/theaisocietyasu/sparky/blob/14cc07c8f753b8d672016a468b86402c2d452614/apps/discord/src/bot/commands.rs) and [memory handlers](https://github.com/theaisocietyasu/sparky/blob/14cc07c8f753b8d672016a468b86402c2d452614/apps/discord/src/bot/memory.rs) expose memory inspection and selective forgetting. Ray already has profile viewing/reset; editing or forgetting one constraint would improve that existing flow.
- **Actionable answer cards:** its [component renderer](https://github.com/theaisocietyasu/sparky/blob/14cc07c8f753b8d672016a468b86402c2d452614/apps/discord/src/render/components.rs) provides source and confirmation buttons. Ray can apply the interaction pattern to Save option, Compare and student responses.
- **Broader student services:** its [architecture](https://github.com/theaisocietyasu/sparky/blob/14cc07c8f753b8d672016a468b86402c2d452614/docs/ARCHITECTURE.md) describes Canvas, calendar, clubs/events and memory through Platform, a separate service. These are integration-dependent capabilities, not free additions from copying the Discord bot.
- **Roadmap distinction:** [personalized discovery/deadlines remain roadmap items](https://github.com/theaisocietyasu/sparky/blob/14cc07c8f753b8d672016a468b86402c2d452614/docs/ROADMAP.md). Do not describe every listed aspiration as implemented.

Our proposed product emphasis: help a group turn discussion into a shared, revisable decision. This is a direction for differentiation, not a claim that nobody else has implemented these features.

## Ranked feature ideas

Effort is relative to the current code, not a delivery-time estimate. Commands below are proposed interaction examples.

### 1. Group fit and honest tradeoffs — core next milestone

**Student:** “@Ray which sections work for all four of us?”

Ray returns a small table of actual sections against each student's constraints: Fits, Conflicts or Unchecked, with reasons. If none fit everyone, explain which constraints conflict and offer alternatives with explicit student coverage. A silent student's compatibility stays unknown.

Why useful: this completes SameClass's original promise and connects the profile workflow to research. It is already planned as milestone 4; it is not a newly discovered extra feature.

Build: deterministic meeting/date/required-component checks; source-backed candidate retrieval; per-student requirement mapping; bounded shortlist; explanations. Do not claim verified fit when required lab rules, meetings or eligibility are missing. Implement one-course group choice before full semester optimization.

Effort: **large**, existing milestone 4. Acceptance: conflicting required lab rejects compatibility; missing evidence remains unchecked; no shared match never silently relaxes constraints.

### 2. Shared shortlist + individual commitment — best companion feature

**Student:** “@Ray save these two sections so we can decide.”

Ray posts a persistent shortlist card with Save/Remove, Compare, Works for me, Can't take it and Need info actions. Record responses per authenticated Discord member and per option/version. An optional reason distinguishes a scheduling blocker from a mild preference. Show “3 of 4 responded; Dev has not responded” rather than treating silence as approval.

Why useful: chat otherwise repeats the same recommendations and loses track of who agreed. A vote is expressed interest, not proof of schedule compatibility or enrollment.

Build: stable option IDs, source/snapshot time, session-scoped shortlist, actor-owned responses, membership checks and version-aware buttons. Keep a confirmed choice distinct from recommendations and from actual registration. Mark choices for review when relevant constraints change.

Effort: **medium**. Acceptance: double clicks do not duplicate a response; students cannot submit another person's response; stale cards cannot silently update the latest decision.

Discord has [native polls](https://docs.discord.com/developers/resources/poll), suitable for informal preference votes. Use app-owned button responses when planning-roster membership, blockers and saved decision state matter.

### 3. “What if?” scenarios — strongest distinctive demo

**Student:** “@Ray what if I allow Friday classes—would we have a shared option?”

Ray compares the current profile snapshot with a temporary change and explains the additional options. The real profile stays unchanged until that student chooses Apply to my preferences. A student can explore a hypothetical involving the group but cannot commit changes to someone else's profile.

Why useful: identifies the smallest explicit compromise that unlocks a shared class, without repeatedly rewriting requirements or quietly weakening constraints.

Build: reuse the fit engine over temporary profile copies, compute result differences and preserve the baseline version. Initially support one student's one time constraint; avoid an open-ended optimization engine.

Effort: **medium after feature 1**. Acceptance: preview leaves stored profiles unchanged; only the owner applies; application against a changed baseline requires a fresh comparison.

### 4. “Catch me up” + decision recap — useful smaller addition

**Student:** “@Ray what have we decided, and what do I still need to answer?”

Return confirmed choices, open options, blockers and unanswered questions, with original Discord message links. Explicitly distinguish “Maya suggested” from “everyone agreed.” Start with structured planning/shortlist records and retained authorized context; Ray does not currently have unlimited server history.

Why useful: a student returning after a busy day can rejoin without reading a long conversation. Decision records make this more reliable than summarizing arbitrary chat.

Effort: **small/medium with shortlist records**; arbitrary channel-history summarization is a separate larger scope. Acceptance: tentative suggestions never become decisions; missing/older context is disclosed; no access to unrelated channels.

### 5. Common free time → study meetup

**Student:** “@Ray find a 90-minute study slot we can all make next week.”

Students explicitly share availability windows or selected schedule blocks. Ray proposes overlaps; the group selects one; an authorized student explicitly creates the meetup. First version can produce a downloadable calendar event without account linking. Discord [scheduled events](https://docs.discord.com/developers/resources/guild-scheduled-event) are another output once permissions and the group's intended audience are established.

Why useful: keeps Ray useful after course registration and directly serves a group problem.

Do not treat a course-planning preference such as “prefer mornings” as complete personal calendar availability. Clarify timezone, exact dates and duration; do not expose private calendar entries to the group.

Effort: **medium** using student-entered windows; calendar-account synchronization is **large**. Acceptance: every proposed slot lies inside each participant's supplied window, and unknown availability stays unknown.

### 6. Opt-in section-change watch — retention feature, later

**Student:** “@Ray watch this section until Friday and tell this channel if seats open.”

Create an explicit subscription with course/section, destination, expiry, frequency and Stop control. Notify only on meaningful changes, such as a transition from zero to available seats; retain observation time and never imply a reservation. Show last successful check and a degraded state after repeated source failures.

Why useful: students can act on a shared decision even when the desired section is full.

Requires durable jobs, restart recovery, bounded source polling, shared checks across subscribers and deduplicated delivery. Current request handling/cache alone does not supply a watcher. This is an explicitly authorized notification exception to ordinary mention-only responses; no background monitoring is enabled by default.

Effort: **medium/large**, after reliable hosting. Acceptance: duplicate workers/restarts do not spam; expiration/Stop work; errors are never interpreted as zero seats; unchanged state stays quiet.

### 7. Syllabus-backed workload calendar

**Student:** “@Ray do these classes have exams or projects due in the same week?”

Extract dated assessment events from exact relevant syllabi and present overlaps, source page references and unknowns. First version: compare two documents with explicit dates. A historical syllabus can illustrate an assessment pattern but cannot supply this semester's actual deadlines.

Why useful: two schedules may fit on a clock yet be difficult together during deadline weeks.

Effort: **medium/large**, depends on available dated sources and extraction review. Acceptance: historical dates are not relabeled; missing dates remain unknown; extracted events can be corrected before export.

### 8. Group study kit

**Student:** “@Ray quiz us on the topics in this week's notes.”

Generate a small set of source-linked practice questions, let students reveal hints/answers, and recap what the group chose to review next. First scope could use already-supported syllabus topics, clearly labeled as practice topics; detailed note-grounded quizzes need a new upload/ingestion path.

Why useful: serves the same students after they start taking the chosen course. Do not promise likely exam questions from a syllabus alone.

Effort: **medium** for a bounded practice interaction, **larger** with secure document ingestion and persistent progress. Start after the planning loop works.

## Supporting Discord improvements

- Selectively edit/forget a saved constraint, with the existing profile/reset flow as the base.
- Buttons for sources and follow-up actions reduce command memorization. State-changing actions need actor and session validation.
- Optional topic threads reduce clutter. Add thread-aware permissions/intake and decide how a thread inherits planning membership before enabling them; today's GuildText filter rejects them. Discord's [thread model](https://docs.discord.com/developers/topics/threads) is a reference.
- Keep ordinary student chat silent. Explicit commands/buttons and valid replies are intentional interactions; opt-in scheduled notifications have their own visible rules.

## Recommended sequence

1. **Verify the imported baseline:** build and offline tests; teammate performs the pending milestone 3 live Discord research/follow-up smoke check. Do not launch a second worker against the same live namespace.
2. **Finish milestone 4's one-course group fit:** actual candidates, per-student reasons, required-component handling and honest unknowns.
3. **Add a small shared shortlist and response card:** persistent options and member-owned Works / Can't / Need info responses. Include a simple decision recap.
4. **Add one what-if preview:** one time-constraint change, before/after results, owner-only Apply.
5. **Deploy and verify persistence**, then choose seat watches or study meetups based on which problem students actually encounter.

Demo story: four students state different needs → Ray finds options with coverage → the group saves two → one student flags a blocker → a what-if preview reveals an alternative → each student responds → Ray records the choice and remaining unknowns. This demonstrates collaboration beyond a single-person course Q&A.

## Scope decisions

Do not begin by adding general web search, generic moderation, voice, Canvas/Outlook linking or a large plugin catalog. Their student value may be real, but they add independent integrations before the existing group-planning workflow is complete. Validate demand through a small group using the shortlist/decision flow; “students would love this” is a hypothesis, not a measured result.

No feature implementation, Discord messages, scheduled monitoring, account connection or deployment was performed by preparing this brainstorm. Existing bot architecture and milestone docs remain unchanged.
