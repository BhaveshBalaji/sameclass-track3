# Ray · local Discord planning bot

Milestones 0–2 implement local startup, portable configuration, Postgres persistence, Discord preference intake through LangGraph/OpenRouter, and a narrow live ASU catalog path. Ray can look up instructors, sections, meeting times and seats for a named course and semester. Syllabus/review research and group recommendations come in later milestones.

## Setup and start

From the repository root, use Node **24.8.0** (`.nvmrc`), Python **3.11+**, and a running Docker daemon with Compose v2:

```bash
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

If `.env` does not exist, copy `.env.example` to `.env`. If it already exists, add only missing values; preserve existing secrets. A file containing just `OPENROUTER_API_KEY` is sufficient for the default local foundation. Configuration is loaded from the root file regardless of the working directory, and process environment variables take precedence.

```bash
npm run dev
```

This command starts the repo's Postgres container, applies application/checkpointer migrations, starts both existing FastAPI apps, waits for health, then starts the Ray Gateway worker. It uses:

| Service | Local address |
| --- | --- |
| ASU API | `http://127.0.0.1:8000` (`/docs`, `/health`) |
| RMP API | `http://127.0.0.1:8001` (`/docs`, `/health`) |
| Docker Postgres | `127.0.0.1:55432`, database/user `ray` |

The default development password is `ray_local_only`, bound to loopback only. Port 55432 avoids the existing system database on 5432. The version-pinned Postgres 17.10 container uses a persistent named volume. The script manages only its own child processes; Ctrl+C stops the worker/APIs. Postgres stays available until:

```bash
npm run db:stop
```

That preserves the database volume. Do not run `docker compose down -v` unless you intend to delete all local Ray data.

A native local Postgres 17 server is an alternative: create a dedicated database/user, set `DATABASE_URL` in your ignored `.env`, and run the same migration/start commands. A custom database URL is treated as externally managed; startup never creates/stops it. No SQLite or cloud database substitution happens automatically.

## Checks and database management

```bash
npm run build          # compile the pinned TypeScript stack
npm test               # offline config, API adapter and SDK-routing checks
npm run db:migrate     # versioned app SQL + pinned checkpointer setup
npm run check:db       # migrations twice, app write/read, checkpoint read in a NEW process
npm run doctor         # DB and both API health checks; reports key availability, never values
npm run check:model    # OPT-IN paid OpenRouter inference; synthetic inputs only
```

The model probe makes three successful calls in the tested path: schema-valid author-owned extraction, a forced synthetic addition tool, and a schema-valid final result. The synthetic tool has no access to Discord, the database or university APIs. Requests are pinned to `deepseek/deepseek-v4.1-flash-1017` / `relace`, with provider fallback disabled and parameter support required. A fetch guard rejects call-level model/provider overrides before dispatch. Output/reasoning/keys are not logged; the probe reports counts, elapsed time and served model/provider metadata. Retries are disabled for this bounded probe.

The validated baseline has `OPENROUTER_REASONING_EFFORT=none`. Two preliminary low-effort runs were inconsistent within the small output caps (including no structured final output). This is a bounded-probe limitation, not proof that reasoning is unsupported. Evaluate reasoning/output budgets per role before enabling it in later milestones. Hiding reasoning text does not disable reasoning or its billing.

Application migrations live in `bot/migrations`, with transaction boundaries, checksums and a migration lock. Never edit applied SQL; add a new numbered migration. The LangGraph package owns its version-pinned schema migrations through `PostgresSaver.setup()`. `db:migrate` is an explicit initialization step, not a network-time operation inside the worker. App tables live in `ray_app`; graph tables live in `ray_checkpoints`. Probe data is removed after checks; development state is otherwise retained. Session, profile, event-deduplication and delivery-outbox tables are included in migration 002.

For a built worker, start the APIs and database first, run migrations, then:

```bash
npm run start --workspace bot
```

## Deployment portability

`DATABASE_URL`, `ASU_API_BASE_URL` and `RMP_API_BASE_URL` are validated centrally. API clients retain configured path prefixes (for example a private backend's `/asu` or `/rmp`) and have bounded timeouts. Set hosted values through Render secrets/environment when deploying; use appropriate TLS/pooler settings from the selected Supabase connection string. Runtime logic and SQL migrations are the same. Domain logic never chooses localhost or a cloud hostname.

The local supervisor manages only default local API URLs. Configured custom API URLs are externally managed. For a deployed worker, use the compiled worker command rather than `npm run dev`. Render/Supabase provisioning and packaging remain Milestone 5 work.

## Discord setup for Milestone 1

1. Create a Discord application named **Ray** in the Developer Portal and configure/install its bot in a private test server.
2. Enable **Message Content Intent**. The client will request Guilds, GuildMessages and MessageContent; a join-button roster does not require the member intent.
3. Install with bot and application-command scopes; allow View Channel, Read Message History, Send Messages and Embed Links in the configured planning channel.
4. Set the token, application ID, guild ID and comma-separated planning channel IDs in the ignored `.env`. Keep the token out of Git, screenshots and chat.
5. Run `npm run register:commands` once (and after command-definition changes), then `npm run dev`. Registration upserts only Ray's three command names in your configured server. Startup connects the Gateway when a token is present; an incomplete Discord configuration fails clearly. Without a token, the worker runs foundation health checks only.

## Try the preference workflow

In the configured server text channel:

1. Run `/ping`, then `/plan start semester:Spring 2027` (use the autocomplete picker).
2. Each student, including the creator, clicks **Join planning**. A session is a shared workspace in this existing channel. Up to 12 students can join with separate profiles.
3. Post your requirements naturally. Ordinary messages from joined students are retained but produce no reply or model call.
4. Mention the actual **@Ray** account to summarize the group. Ray extracts each author's own hard constraints, soft preferences and explicit flexibility, preserving unknowns. A name typed as plain text is not a Discord mention.
5. Answer a follow-up with Discord's **Reply** action to the bot message; the intended author need not mention Ray again. Silent participants are asked once.
6. Use `/plan status`, `/plan profile`, `/plan reset-profile` or `/plan reset-session`. Profile/status output appears in the planning channel; temporary command acknowledgements disappear after the channel answer is delivered. Mentions use a typing indicator rather than a separate progress message. Session reset requires creator/moderator permission and an actor-bound confirmation valid for five minutes.

**Leave planning** stops future intake. Your own reset removes saved facts and retained source messages; session reset removes all session profiles/context. Resets invalidate in-flight results. Graph checkpoints contain request IDs/status, not student messages or profiles. Already-posted Discord responses remain in channel history.

`/ask question:Who teaches CSE 575 in Spring 2027, and are there seats?` works without joining. An actual @Ray mention with the same question also works. If a session is active, you can omit the semester; an explicit semester overrides the session for that lookup. A missing year, relative semester or multiple courses/semesters prompts clarification rather than a guess. Questions do not join you or alter profiles.

Catalog questions use one typed class-search API call (up to two source pages, all seat statuses) with deterministic identity checks and rendering. They do not use an LLM or call syllabus/RMP services. Answers follow the requested fields. Professor-only questions return unique names across all fetched sections, a single ASU citation, and any missing-instructor/partial-coverage note. Seat/time questions show the relevant per-section facts; combined questions include the requested fields. Full section details remain available when requested. Link preview cards are suppressed to keep answers compact. Up to eight returned sections are displayed, with an ASU link for the rest. An empty complete search is reported as no listings; a partial search or source failure is never proof that no classes exist. Seats are observations, not enrollment guarantees.

Use readable semesters such as **Spring 2027**, **Summer 2027** or **Fall 2027**. The bot stores ASU codes internally to preserve existing sessions. Legacy code inputs still work, but the command picker and replies use names. Syllabus/RMP research starts in Milestone 3. Brief model-processing consent is shown when starting a planning session; internal versions, repeated join disclosures, heartbeat logs and API access logs are omitted from routine output.

Context defaults to 100 messages / 30,000 characters, with individual input capped at 4,000 characters. Configure `PLANNING_MAX_MESSAGES`, `PLANNING_MAX_CHARACTERS` and `PLANNING_MAX_PARTICIPANTS` as needed (12 participants maximum). Saved facts outlive the rolling context and retain up to 12 evidence quotes per field. Displayed fact values are abbreviated. A newer message arriving during extraction invalidates the older snapshot; mention Ray again to refresh.

Gateway buttons, profiles and pending clarification references persist through restart. Uncertain sends are not blindly retried; explicitly request a fresh status/summary if a send cannot be confirmed. Run one worker per database namespace in this initial local version. Do not start concurrent workers against the live Discord namespace.

## Synthetic replay and verification

```bash
npm test                      # offline foundation, semester and catalog-contract checks
npm run test:planning         # real Postgres state and delivery regression tests
npm run replay                # deterministic four-student application replay
npm run replay -- --live      # opt-in paid OpenRouter replay with synthetic students
```

Replay uses the same application handlers as Discord, synthetic identities and an isolated local `ray_m1_test` database. It never posts fixtures to Discord. A remote test database must be explicitly configured with `RAY_TEST_DATABASE_URL` and have `test` in its name; replay is disabled in production. Replay state/checkpoints are removed afterward. These deterministic fixtures are tests, never automatic fallback data for real students.

The [readable four-student scenarios](../docs/mock-chat-scenarios.md) and `bot/test-data/conversations/four-students.json` cover author isolation, a silent participant, direct replies, corrections and question isolation. Milestone 4 expands this suite to complex workflows and evidence failures.

The live synthetic OpenRouter replay passed, and the user confirmed the requested private-server smoke workflow worked. A subsequent worker restart reconnected the Gateway and preserved the live session state exactly. Milestone 1 is complete. Milestone 2 live API checks returned no CSE 512 Spring 2027 listings and two CSE 575 sections; the user confirmed the live Discord answer and semester picker work. Milestone 2 is complete.
