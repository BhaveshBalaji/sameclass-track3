# SameSection design review

Status: the team accepted the recommended direction and requested a milestone plan on October 24, 2026. The [Discord bot milestones](discord-bot-milestones.md) are now the canonical implementation checklist. Application implementation has not started.

## Established input

The [project brief](project-brief.md) supplies the initial requirements. Track 3 is the target; Track 1 completion is team-reported. The architecture and scope remain open to challenge during this review.

Product invariants already stated in the brief: each student controls their preferences; silence is unknown; recommendations may differ among students; course questions do not alter plans; actual research uses live integrations; deterministic code checks hard compatibility; research workers return evidence to the coordinator; students make the final decision.

The team's workflow confirms Discord as the first chat interface, an agent coordinator with subagents as the backend, mention-triggered group research, targeted participant questions/direct replies, useful responses despite a silent fourth student, and individual course questions with historical syllabus labels. An owned chat UI is optional later, with minimal changes to the core. The [workflow and architecture plan](workflow-architecture.md) develops these requirements. Ordinary Discord group DMs cannot host this bot; a server text channel is the supported initial surface.

## Validity assessment

- Track fit: the proposed Discord assistant addresses a concrete campus group-chat problem and fits the published Track 3 description.
- Product value: plausible, but not yet validated by a real student planning trial or measured result.
- Technical feasibility: the platform shape is supported by official documentation, but no application or live verification exists here yet. See platform findings below.
- Data feasibility: confirmed against fetched `origin/main` commit `ad226d4f73a4a9b3d30993f2e39de5767249dd7d`. The local branch still has no commits and contains our untracked planning documents, so the new API commit was inspected and tested in an isolated temporary snapshot rather than overwriting local notes. Catalog search, syllabus extraction, and RMP review retrieval passed a current live smoke check. See [integration validation](integration-validation.md) for scope and remaining limitations.
- Community evidence: DevRelay lookup was attempted, but the connector returned an account-connection error. No community consensus is claimed.

## Verified platform findings

- Reading ordinary planning conversation requires Discord's [Message Content Intent](https://docs.discord.com/developers/events/gateway#message-content-intent). Mention-only access does not expose all preceding unmentioned messages.
- Discord [message references and allowed mentions](https://docs.discord.com/developers/resources/message) support deterministic clarification-reply routing and explicit allowed recipient lists. These controls should not depend on model judgment.
- The [Gateway lifecycle](https://docs.discord.com/developers/events/gateway#connections) requires a persistent process with heartbeat and reconnect handling.
- The [AI SDK](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data) supports validated output with tools, and an [official OpenRouter provider](https://github.com/OpenRouterTeam/ai-sdk-provider) exists. [Structured-output support](https://openrouter.ai/docs/guides/features/structured-outputs) still depends on the selected model and serving endpoint; validation does not prove factual correctness.
- [SQLite](https://sqlite.org/whentouse.html) is plausible for an initial single-host deployment with short writes and durable storage. [WAL](https://sqlite.org/wal.html) requires database processes on the same host rather than a shared network filesystem.

These findings verify documented capabilities, not live integration behavior. No orchestration framework has been selected.

## Accepted decisions

The team accepted all recommended actions:

1. Explicit Join planning interaction with a model-processing notice.
2. Ranked section shortlists and individual alternatives, with complete semester optimization deferred.
3. Independent rooms for the optional owned UI; no initial Discord/web synchronization.
4. ASU graduate CS elective planning as the first demo audience.
5. Local development followed by a persistently hosted bot.
6. Preserve Python integrations and call them through typed TypeScript adapters.
7. Keep Discord transport outside the shared application core.

Architecture direction: retain the existing Python integrations; use a TypeScript application core with transport adapters, scoped research workers, deterministic matching and SQLite state. [ADR 0001](adr/0001-isolate-chat-transports.md) records the accepted transport boundary.

The milestone plan supplies the interaction sequence, worker responsibilities, initial configurable limits and targeted verification. Exact dependency pins/model configuration are settled in Milestone 0; a hosting provider and budget are selected at deployment. The user requested mock multi-student conversation data and focused functional testing; [the scenario pack](mock-chat-scenarios.md) is prepared, with machine-readable replay delivered in Milestone 1. These remaining implementation choices do not require another design interview before starting Milestone 0.
