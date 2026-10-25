# Ray · local foundation

Milestone 0 implements reproducible local startup, configuration, API health clients, versioned Postgres migrations, LangGraph checkpoint persistence, and explicit OpenRouter capability checks. The worker deliberately does **not** log in to Discord or implement sessions/recommendations yet; those begin in Milestone 1.

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

This command starts the repo's Postgres container, applies application/checkpointer migrations, starts both existing FastAPI apps, waits for health, then starts the foundation worker. It uses:

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

Application migrations live in `bot/migrations`, with transaction boundaries, checksums and a migration lock. Never edit applied SQL; add a new numbered migration. The LangGraph package owns its version-pinned schema migrations through `PostgresSaver.setup()`. `db:migrate` is an explicit initialization step, not a network-time operation inside the worker. App tables live in `ray_app`; graph tables live in `ray_checkpoints`. Probe data is removed after checks; development state is otherwise retained. Discord session/profile tables arrive in Milestone 1.

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
5. Milestone 1 registers development-guild `/ping`, `/plan` and `/ask` interactions and verifies acknowledgements, actual mention metadata and persistent buttons. This milestone's worker does not register commands, send messages or require a token.

The prepared [four-student scenarios](../docs/mock-chat-scenarios.md) remain the behavior specification. Their machine-readable replay and the complete preference workflow are Milestone 1 work; the later expanded scenario suite remains Milestone 4.
