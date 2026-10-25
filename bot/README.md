# Ray · local Discord planning bot

## Voice Ray (implemented; live acceptance pending)

Voice is off by default in the checked-in configuration. Locally it is enabled with the dedicated ElevenLabs agent, **ray-help** voice channel and **ray-voice-help** text channel. Voice controls run only in that text channel; attempts from the original planning channel receive a private redirect. Main text planning remains available. The user confirmed an audible reply to a real microphone request before the channel move. The worker is running with the new setup; two-person attribution, interruption recovery and full rehearsals remain pending. See [V0–V4 evidence](../docs/voice-ray-milestones.md).

The ElevenLabs plugin created a dedicated development agent. Its nonsecret ID and tool/voice configuration are in `bot/voice-agent.json`; it requires authentication, has voice recording disabled and agent transcript retention set to one day. Separate Scribe transcription has its own provider retention policy; zero retention is not claimed. A plugin login does not automatically give the local worker an API key.

Add the following values to the existing ignored root `.env` without replacing its other credentials:

```dotenv
VOICE_ENABLED=false
ELEVENLABS_API_KEY=your_runtime_key
ELEVENLABS_AGENT_ID=agent_7501m5scd31dfd6sgqtr92yj8e2d
DISCORD_VOICE_CHANNEL_ID=your_server_voice_channel_id
DISCORD_VOICE_TEXT_CHANNEL_ID=your_voice_commands_and_results_text_channel_id
VOICE_INTERRUPTION_RMS=1000
VOICE_MAX_PARTICIPANTS=4
VOICE_MAX_DURATION_SECONDS=1200
VOICE_MAX_TURNS=30
```

Use a runtime key from the same ElevenLabs workspace with agent conversation and realtime speech-to-text access. Never put it in source code, Discord messages or screenshots. The single configured regular voice channel must belong to the configured guild; Ray needs View Channel, Connect and Speak. The worker requests `GuildVoiceStates` only with voice enabled and joins without self-deafening. Its computer/network must permit Discord voice UDP traffic; hosted deployment is deferred.

```bash
npm run check:voice             # local setup, Opus and DAVE dependency checks; no inference
npm run check:voice -- --live   # OPT-IN PAID synthetic agent/audio/tool proof; no Discord posts
npm run check:voice -- --live --scribe # also transcribe the same generated synthetic audio
npm run check:discord-voice -- --connect # worker stopped, EMPTY channel only; silent playback, no capture
npm run test:voice             # offline protocol/controller/audio regressions
npm run test:voice:planning    # isolated Postgres preference/planning regressions
```

After configuration and the provider proof, set `VOICE_ENABLED=true`, register commands with `npm run register:commands`, then start the worker normally. Avoid a second worker connected to the same live Discord/database namespace.

1. Use **ray-voice-help** for voice commands. Planning is optional for basic questions and notes. For shared recommendations, use `/plan start`, choose a semester and click **Join planning**. Starting planning preserves guest voice notes. This channel has its own workspace.
2. Join the configured voice channel. Each student runs `/voice join consent:true` in that same text channel to opt in to audio/transcript processing. `consent:false` shows the notice. Being in the voice channel alone does not opt someone in.
3. Speak naturally; finalized utterances become bounded, author-attributed pending notes. Say “Hey Ray, what is CSE 445 about?” for a course answer; source-linked detail appears in text. Every request, including follow-ups, must address Ray. Ordinary conversation does not interrupt a pending answer. Saying “Ray” can interrupt playback once recognized by transcription.
4. Ask “Ray, what have you noted for me?” to refresh/read only your profile. Correct your own preferences, then request another read-back. Research questions do not become planning facts. A group recommendation refreshes all joined members' pending notes, including their text contributions.
5. Ask “Ray, recommend classes for our group.” Ray calls the existing planner; the spoken names/courses and posted assignments come from the same allocated options. The result remains a proposal and retains missing-data/eligibility qualifications.
6. Ask for a session recap to summarize saved needs/proposed section IDs and unresolved unknowns in text and voice. Ask “Ray, why that option?” while the bounded conversation context remains active for a brief explanation. Ray does not infer votes or acceptance.
7. `/voice pause` and `/voice resume` are for the planning-session owner/moderator. `/voice leave` removes your capture; the last participant leaving disconnects Ray. `/voice end` ends the room for the owner/moderator. Channel departure revokes audio intake. Leaving planning does not revoke separate voice consent; use `/voice leave` to stop audio intake. Profile reset clears retained sources and ephemeral voice conversation context.

The session stops after 20 minutes and has a 30-addressed-turn cap. End/rejoin manually after a connection failure or exhausted session; saved profiles persist but audio is never replayed. Speech bursts are limited to 30 seconds. Start with turn-taking and headphones: overlapping humans, background noise and acoustic echo are outside the demo's verified behavior. An explicitly addressed Ray utterance stops buffered Ray audio after transcription recognizes the address; stale provider/tool results are suppressed. The controller reconnects the hosted agent for each addressed turn, restoring up to six bounded conversation entries; it does not promise seamless provider session recovery.

Successful client-tool results explicitly send `is_error:false`, as required by the live provider. Some live voice sessions did not send `agent_response_complete`; after final answer text, a two-second quiet-audio fallback finishes the stream only when no tools are pending. Recognized Ray interruptions stop playback; unrelated human speech does not. A focused regression covers quiet pre-tool acknowledgements and delayed research results so this fallback does not end a turn while research is running.

Ray now uses **Jessica**, a warm female conversational voice, with a less formal persona and explicit spoken summaries after tool results. A newly opted-in participant receives a short greeting when Ray is idle; greeting events do not enter their notes or invoke research tools. The initial acknowledgement's audio cannot satisfy the final-answer completion check: after a tool returns, Ray waits for new spoken-answer audio. A live delayed-tool check verified 330,240 bytes of speech after the result. Quiet comfort-noise/clicks must pass a sustained-speech gate before they open transcription or interrupt Ray; `VOICE_INTERRUPTION_RMS` adjusts its sensitivity.

Reconnecting waits for the previous socket's close acknowledgement and a short provider-cleanup interval, since the development workspace allows only one active conversation. During debugging, `VOICE_DIAGNOSTICS=true` logs capture phases, packet/PCM counts and transcription character counts; it does not log transcripts, audio or credentials. Leave it false for routine use. If repeated speech keeps interrupting Ray before an answer, use headphones and test one complete question followed by a quiet pause.

Scribe uses speech-based VAD to finalize utterances rather than relying solely on Discord's silence-packet behavior. Explicit receiver end and the 30-second cap can also commit a turn. Empty transcription results release capture immediately and do not become notes, so a quiet or unrecognized turn cannot block subsequent speech.

Automatic proactive suggestions are deferred. Complete the two-person audio/source/interruption checks and the checklist's two rehearsals before marking voice milestones complete. No live source answers are replaced by demo fixtures.

If Ray is present and shows **listening** but stays quiet after “Hello,” address it explicitly: **“Hey Ray, what have you noted for me?”** Ordinary discussion is retained as pending notes without a spoken reply. A spoken response requires addressing Ray on every turn; there is no automatic follow-up window. The listening notice now states the wake phrase, and unaddressed speech updates status with the same hint.

Milestones 0–3 implement local startup, portable configuration, Postgres persistence, Discord preference intake and LLM-driven course research. LangGraph coordinates a planner, bounded research workers and an answer writer. DeepSeek through OpenRouter/Relace selects relevant research tasks; the AI SDK tool loop calls scoped ASU/RMP tools. Shared schedule recommendations remain Milestone 4 work.

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
6. Use `/plan status`, `/plan profile`, `/plan reset-profile` or `/plan reset-session`. Profile/status output appears in the planning channel; slash commands receive a public response attached to the command; Ray never deletes the command response or your message. Mention answers use Discord Reply on the original message. A native typing indicator replaces extra progress posts. Session reset requires creator/moderator permission and an actor-bound confirmation valid for five minutes.

**Leave planning** stops future intake. Your own reset removes saved facts and retained source messages; session reset removes all session profiles/context. Resets invalidate in-flight results. Graph checkpoints contain request IDs/status, not student messages or profiles. Already-posted Discord responses remain in channel history.

`/ask question:Who teaches CSE 575 in Spring 2027, and are there seats?` works without joining. An actual @Ray mention with the same question also works. If a session is active, you can omit the semester; an explicit semester overrides the session for that lookup. A missing year, relative semester or multiple courses/semesters prompts clarification rather than a guess. Questions do not join you or alter profiles.

`/ask` now uses the same LLM research path as course-information mentions. The planner selects only relevant catalog, course-detail, syllabus or review tasks. The model writes a question-specific answer from retrieved evidence; the older deterministic catalog renderer remains covered by contract tests but is not the production `/ask` coordinator. Source links are constructed by code, not invented by the model.

Try “Who teaches CSE 240 in Spring 2027?” or “For CSE 575 in Spring 2027 with Yingzhen Yang, summarize the syllabus exam grading and relevant RMP reviews.” Missing course/year information is clarified. Research keeps six recent exchanges per user/channel and supports explicit replies to Ray, including a reply to an older answer. Ordinary messages do not invoke Ray. Known courses, semesters and instructor shortlists carry into follow-ups. General questions and professor-only RMP questions do not require unnecessary course/semester intake. The active planning semester can be reused, but profiles are not changed by research questions.

Syllabus tools verify a current offering before requesting its exact term/section text. Only a 404 triggers the backend’s labeled historical same-instructor/other-instructor fallback; timeouts/rate limits are not evidence of absence. Answers retain source semester/section/instructor, page references, truncation and missing/OCR status. Historical grading is not a claim about the current offering. Citations labeled **Syllabus Link** open the actual source document, including a historical document. Cached syllabus text gets a fresh download URL before reuse. A resolving backend document route is used if the source URL cannot be refreshed. **Class Link** points to ASU classes; professor RMP links use the instructor name.

RMP tools use ASU school 15723 with cross-school fallback disabled. A name, school and department must match before review access; duplicate/unresolved matches stay ambiguous. Department validation is currently conservative for computing subjects (CSE/CS/CIS/IFT/SER); other departments remain unresolved rather than guessed. Review tools consume pages incrementally, keep earlier successes after later failures, and preserve dates/raw course labels. Exact normalized course labels are separated from general instructor comments. Ratings and reviews are student opinions, not verified course policies.

Use readable semesters such as **Spring 2027**, **Summer 2027** or **Fall 2027**. The bot stores ASU codes internally to preserve existing sessions. Legacy code inputs still work, but the command picker and replies use names. Shared schedule compatibility and recommendations start in Milestone 4. Brief model-processing consent is shown when starting a planning session; internal versions, repeated join disclosures, heartbeat logs and API access logs are omitted from routine output.

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

## Research limits and live check

The worker uses a process-wide scheduler: four active model/source operations total, at most two per source/provider, 12 candidate sections, 12 planned tasks and 12 source operations per request. Cached reads count toward the source-operation budget. Up to 18 model calls are allowed, with one reserved for the answer writer. Planner/worker/writer output caps are 1,800/1,200/2,200 tokens; each serialized model input is capped at 100,000 characters. Workers have at most four model/tool steps and a 20-second deadline; the overall request deadline is 90 seconds. Catalog/details/syllabus workers finish after their first scoped tool call; review workers may use the remaining steps for identity and pagination. Request-scoped aborts reach HTTP/model calls. Python may still finish an already-running upstream request after the caller times out.

Set the `RESEARCH_*` variables in `.env.example` to tune the bounds. No automatic coordinator retry occurs. ASU/RMP adapters forward `Retry-After` for 429/503; the scheduler applies source cooldowns. Python transport retries remain limited to transient 502/504 responses, avoiding stacked rate-limit retries.

Public-source evidence has a bounded process-local cache (256 scopes): catalog/seats two minutes; syllabi/details/reviews 24 hours. Identical in-flight scopes share work, successes carry original retrieval time/reuse age, and explicit fresh/latest requests bypass completed-cache entries. A waiter can cancel independently; cancellation of the original owner may leave another waiter with a partial result. Cache state does not survive worker restart. LangGraph stores request ID/status only; it cannot resume a half-completed research run after a restart. Submit a new request to retry.

```bash
npm run check:research              # opt-in paid synthetic/public CSE 575 model/API check
npm run check:research -- 'Who teaches CSE 240 in Spring 2027?'
```

The check reports model/provider, call counts, latency and token usage plus the public answer. Runtime Discord conversations, raw syllabus/review payloads, secrets and reasoning are not logged. The CSE 575 live run retrieved a **Fall 2026** same-instructor syllabus (section 65678) after the current offering’s syllabus was absent, confirmed Yingzhen Yang’s ASU RMP identity and retrieved review evidence with course labels/dates. A successful combined run took about 15 seconds with seven model calls. Catalog-only CSE 240 used three model calls and one source operation. These checks demonstrate bounded behavior, not universal answer accuracy. Expanded model/scenario evaluation remains later work. The new public-command/native-reply Discord smoke check is pending.

Reply-context refinement: independent retrieval workers now run directly after the LLM plan, removing redundant worker-model calls. The normal research path needs two LLM calls (plan and answer). Comparisons dispatch one reviews worker per known instructor concurrently. Review pagination uses up to 100 reviews/page and 20 pages, with the existing deadline and a 24-source-operation budget; cached/in-flight reads do not consume another source operation. All fetched course labels are normalized for case and spacing. Writer excerpts prioritize course-specific reviews, with explicit full-corpus versus excerpt counts. Six recent research turns per user/channel and up to 100 recent reply associations are persisted; profile/session resets invalidate relevant context. New defaults supersede the earlier worker-model-step description. A focused live CSE 240 follow-up completed in about 6.7 seconds using two model calls; one instructor remained unresolved rather than being misidentified.

The orchestrator also has a bounded evidence-assessment step: after the first retrieval batch it may dispatch one additional batch (catalog → discovered professors → reviews, or course details/syllabus when still needed). This usually uses three model calls. A course-level review request with no instructor researches all listed instructors within the existing caps. RMP identity searches inspect bounded 100-result pages; fuzzy-name matches alone do not make an exact match ambiguous. Explicit failure reasons are retained. Answers use short headings and bold-name bullets.

Context/syllabus correction: reply memory now walks a bounded parent chain, and task validation fills omitted course/semester fields from structured saved scope (including legacy ASU term codes). A known course is not re-requested just because a model omitted a tool argument. Syllabus extraction now requests up to 100,000 characters rather than 18,000. The writer receives query-relevant, page-labeled excerpts within its input budget; structured coverage distinguishes extraction limits from writer excerpts and explicitly states that the original PDF is unchanged. A live CSE 445 document returned 20,739 characters over nine pages without extraction truncation.

## Milestone 4 group planning

Use `/plan recommend` in a session you have joined, or mention Ray with “find classes we can take together.” Profiles retain flexible, author-sourced planning facts rather than a fixed field enum; familiar keys remain compatible, and additional facts such as accessibility or commute limits are retained. Storage is bounded to 40 fact keys per participant. A derived planning view normalizes constraints without replacing the stored profile. Unsupported hard constraints remain explicitly unchecked.

The group engine uses bounded catalog searches, deterministic per-student checks, at most 12 primary candidates and two research-shortlist entries by default. It checks every known meeting interval, stated date/time restrictions, campus, course lists and per-course credits. Online/campus cohorts use their corresponding catalog mode. Source-verified linked-component rules are required before calling a lecture/lab/recitation bundle verified; existing API results often lack those rules, so those options remain preliminary. Student-approved lists do not establish degree eligibility. Semester credit totals, degree applicability and enrollment are not verified.

Independent shortlisted research runs concurrently and is scoped to the selected offering/instructors. Soft-fit notes must quote supplied research and reference the correct student's soft fact. Unknown students do not count as flexible. Corrections, leave and confirmed reset cancel old work; a version check prevents stale results from being published. Direct clarification replies refresh an existing plan.

`npm run test:group` runs nine curated deterministic scenarios against isolated test storage. `npm run check:planning` is an opt-in paid, labeled four-student demonstration with live APIs/model calls and no Discord posts. One live demonstration completed and returned individual preliminary alternatives where no shared option met the stated lists. Nine group regressions, the affected ten planning regressions and the TypeScript build passed. The new Discord group-command smoke check is pending. Configuration: `PLANNING_MAX_CANDIDATES`, `PLANNING_RESEARCH_SHORTLIST`, and `PLANNING_TIMEOUT_MS`.


### Broad course discovery and natural preferences

Students can say “I need two CSE 5xx courses” or discuss AI/database interests; a fixed approved-course list is not required to begin research. `/plan recommend` processes retained messages for every active participant, including pending messages from a student other than the requester. Work hours stay hard exclusions; “morning/noon” and free days “if possible” stay soft preferences. Missing campus/credit/degree rules leave the corresponding checks unknown without starting a compulsory intake questionnaire.

Extraction combines duplicate same-strength fields with their author-owned sources and makes at most one repair attempt for invalid source references or conflicting field strengths. Literal first-person course counts/families are grounded in the messages. Failure retains the messages/cursor for retry and names the affected student rather than treating them as silent. `/plan profile` labels the personal view without implying that only one student joined the group.

ASU's live exact course-number filter does not expand `5` to `500–599`. The group catalog adapter instead retrieves the requested academic level and locally filters the course family. AI/database title relevance determines which candidates receive bounded research; a relevant title never proves workload, professor quality or eligibility.

`npm run test:group` now includes the two-student conversation regression (16 tests total). `npm run check:discovery` is an opt-in paid check using synthetic identities and the reported broad-course conversation: two extractions and one projection, with at most one validation repair per extraction. It asserts separate counts, the three work windows, soft Friday preferences and CSE 5xx discovery. It does not post to Discord or write to the database. The live catalog adapter was separately verified against Spring 2027: 42 CSE 5xx sections were retrieved on October 25, 2026. This is a source observation, not a verified shared schedule.


### Recommendation schedules, evidence and Discord presentation

The group planner now builds separate course sets for each participant. It checks known work blocks, explicit allowed time windows, every retrieved meeting interval, required components, duplicate courses, full sections and class-to-class overlaps before assigning a section. “Available anytime before 5 PM” is a hard attendance boundary; morning/noon and a free lunch break phrased as preferences remain soft. Existing misclassified soft fields can be interpreted using their author-sourced original quote/message without resetting the session.

A bounded allocator first fills each student's requested course count, then maximizes shared enrollments, then considers supported soft fit. It can propose one class shared by two people and different additional classes for other members. No universal section is required. It searches at most four courses per student, 4,096 schedule states per student, 96 retained options per student and a 128-state group beam over the bounded candidate pool. This is the best plan found within those limits, not a global optimality claim. Unknown meeting/attendance data prevents automatic assignment. Unknown lab rules or other requirements keep the suggestions preliminary.

Known student time and source checks are deterministic. Evidence analysis considers all supplied soft facts with validated quotes. Supported preference evidence adds 2, tradeoffs subtract 3; historical syllabi receive half weight (one quarter for another instructor), general instructor-only reviews receive lower weight, and partial review coverage reduces confidence. Explicit easy-workload priorities receive an additional penalty for verified high aggregate professor difficulty. These are transparent initial heuristics, not a calibrated prediction of grades/workload. Missing evidence never proves a class is easy.

For group recommendations, direct tools retrieve official course details, scoped syllabus text and professor review evidence in parallel under the existing process-wide scheduler and a shared source-call budget. One bounded analysis step extracts short findings and per-student preference assessments. The group path no longer invokes an independent free-text recommendation writer per section. Each finding must match its exact section/evidence ID and a verbatim evidence substring. Historical/different-instructor evidence and course-specific versus general review coverage are labeled in the final answer. Independent successful sources survive sibling failures.

Each participant receives an individual inline Discord mention with their course count, selected sections, meeting times and material tradeoffs. A short overall summary follows, then evidence cards only for the selected sections, with schedule/syllabus/review links, ratings and substantive heads-ups. No detached research paragraphs or unvalidated alternative-section recommendations are appended. Missing workload evidence is stated directly.

`npm run test:group` includes 23 group/discovery/recommendation checks. The controlled parallel/sequential comparison uses identical fixed-delay sources and asserts the same recommendations, section associations and mention metadata while observing the configured source cap. This measures orchestration waiting, not live-provider latency or natural-language accuracy.

`npm run check:recommendation` is an opt-in paid live check using `recommendation-feedback.json`, synthetic Discord identities, the configured model and live public ASU/RMP services. It does not post to Discord or write to the database. It independently checks returned assignments against the reported Monday/Tuesday/Wednesday work blocks, before-5-PM boundary and mutual class overlaps. Set `RAY_RECOMMENDATION_PREVIEW` to an absolute local output path to save a readable preview; signed document links are redacted only in that preview/log. The planner's actual response retains its source destinations. New code still needs a live Discord rendering/mention smoke check after restarting the worker.
