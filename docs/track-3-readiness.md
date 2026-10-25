# Track 3 readiness

Reviewed October 24, 2026 (America/Phoenix).

The team has accepted the recommended design direction. Use [Discord bot milestones](discord-bot-milestones.md) as the canonical build checklist and [mock chat scenarios](mock-chat-scenarios.md) for the prepared synthetic group exercise.

## Official requirements

Sources: [event page](https://hackathon.cubbie.ai/#hackathon), [official agent guide](https://hackathon.cubbie.ai/skill.md), and [official kit rules](https://github.com/imaginix-inc/cubbie-hackathon-kit/blob/main/skills/cubbie-hackathon/references/rules.md).

- Track 3 is a group-chat assistant tied to real campus life. Discord is allowed; Cubbie is optional.
- Track 1 submission unlocks Track 3. The team reports Track 1 is complete; account-level submission was not independently checked.
- Deliver a working prototype and explain why students would invite it into their group.
- If using multiple agents, demonstrate conflicting constraints, information sharing, and when students confirm decisions.
- Submit a GitHub repository; use a public repository for the gallery preview. Website and demo video are optional.
- Teams contain 1–4 members. Team/project names are limited to 60 characters, the one-line pitch to 140 characters, and links must use HTTPS.
- Judging is private. The published page says full criteria are announced before kickoff; no detailed rubric is provided in the reviewed sources.
- Live organizer settings checked at **7:02 PM Phoenix time on October 24, 2026**: Track 3 is open and no closing time is configured. This is a snapshot; recheck before relying on it. The site labels dates and scoring a working draft.
- Submission publishes the entry immediately. Prepare and review the exact entry before requesting final publication approval.

## Product understanding

SameSection supports a group planning conversation, with shared options and individual alternatives. It does not force identical schedules or enroll students.

Each student's own statements establish their hard constraints, soft preferences, explicit flexibility, and unknowns. Corrections update only the relevant fields for that student. Silence is unknown availability. A course question does not change a plan.

The assistant operates in configured channels, responds to actual mentions or direct replies to outstanding clarifications, and keeps ordinary conversation silent. Incomplete participants do not block useful preliminary responses for others.

Later recommendations use the real ASU Class Search and professor-review integrations. API schemas, credentials, and capabilities must be inspected before adapters are written. Product behavior must never silently substitute mocks for live data. Historical syllabus evidence is labeled by term and instructor, and is not treated as verified upcoming assessment requirements.

## Existing state and missing inputs

At inspection, this workspace contained only an initialized Git repository with no commits. There was no application, API adapter, API documentation, environment file, or repository instruction file. The supplied brief says working Class Search and Rate My Professors APIs exist elsewhere; they are not yet available here.

Update after the team's repository change: fetched `origin/main` commit `ad226d4` contains both complete Python API integrations. They were reviewed and tested independently without overwriting the untracked planning documents. The [integration validation](integration-validation.md) supersedes the earlier missing-integration assessment. The Discord application is still unimplemented.

Before live Discord verification, the project needs a Discord application/bot token, server and planning-channel IDs, channel/history permissions, Message Content Intent configuration, and model-provider credentials/model identity. These belong in local environment configuration, not chat or committed files.

Before Milestone 2, use the now-confirmed catalog API contract to implement a typed adapter. Later research must preserve exact section identity, resolve RMP candidates, and handle the documented reliability gaps. The integrations require no student credentials or model keys; bot/model configuration remains necessary for Milestone 1.

## Architecture specified by the brief

- Persistent Node.js process with TypeScript and discord.js for the Discord Gateway connection.
- Model extraction/orchestration through a tool-capable SDK with validated structured output; the brief prefers Vercel AI SDK with OpenRouter, subject to compatibility verification.
- Zod schemas and SQLite persistence for sessions, participants, bounded context, profiles, request versions, and clarification state.
- Separate transport, orchestration, research, adapter, matching, and rendering modules.
- Later research uses bounded concurrent workers with scoped tools and validated evidence envelopes. Catalog retrieval can be ordinary API code. The matching engine deterministically checks times, dates, credits, availability, and supplied requirement rules.
- Workers return evidence to the coordinator; only the coordinator produces Discord responses. Task budgets, timeouts, retries, caching, deduplication, partial failure, and operational logs are explicit responsibilities.

## Implementation milestones

- [ ] **1. Discord and preferences:** configuration/connection; explicit session creation and membership; bounded history; mention-triggered extraction; author-scoped versioned profiles; targeted clarification/direct replies; status/reset; duplicate-event and stale-request protection.
- [ ] **2. One live catalog path:** resolve who teaches CSE 512 for a selected semester and report listed availability with source and timestamp.
- [ ] **3. Parallel research:** bounded scheduler, syllabus and professor agents, validated result envelopes, partial failure, caching, and observability.
- [ ] **4. Group recommendations:** deterministic compatibility, shared and individual options, changed preferences, historical labels, and backup sections.
- [ ] **5. Verification and demo:** missing data, identities, timeouts/rate limits, duplicates, stale responses, conflicting constraints, and no shared match.

Milestone 1 implementation order: configure transport and persistence; establish explicit sessions and participants; add structured preference extraction and author-scoped updates; add clarification/reply routing and controls; verify idempotency, versioning, mention safety, and restart persistence. Recognize course questions but say research is not connected. Verify ordinary messages stay silent and incomplete participants do not block the group. Stop after Milestone 1 verification before starting Milestone 2.

No application code was implemented during this requirements-review task.

## Installed planning skills

Installed from [mattpocock/skills](https://github.com/mattpocock/skills), pinned to commit `5beb35b040e3de97e54fa9e386d7e42d15c295c2`, under `~/.codex/skills/`:

| Skill | Purpose |
| --- | --- |
| `grill-me` | Interview to sharpen a plan |
| `grill-with-docs` | Interview with glossary and decision documentation |
| `grilling` | Shared interview dependency |
| `domain-modeling` | Glossary and decision-documentation dependency |
| `to-spec` | Synthesize the settled discussion into a specification |
| `to-tickets` | Break the plan into verifiable tasks and dependencies |
| `setup-matt-pocock-skills` | Configure the tracker and documentation conventions used by the planning flow |

All seven `SKILL.md` files and their linked local references were verified present. The requested names “grillme” and “grillme-withdocs” map to `grill-me` and `grill-with-docs`. These were installed, not invoked as an interview. They are available on the next turn. No issue tracker, tickets, external publication, or account sign-in was created.
