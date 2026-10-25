# Discord documentation consulted for the milestone plan

Checked October 24, 2026 (America/Phoenix). These are documentation findings, not live Discord verification.

## Context7 MCP retrieval

Connected to the already-configured Context7 MCP server using MCP initialization, tools discovery, `resolve-library-id`, and `query-docs`. Selected `/discordjs/guide` for library usage and `/discord/discord-api-docs` for protocol requirements.

Queries covered:

1. Gateway intents for ordinary guild messages and bot-message filtering.
2. Persistent join-button routing through `interactionCreate`, actor identity, and prompt interaction acknowledgement/defer.
3. Initial interaction response deadlines, token lifetime, and explicit allowed mentions.

Context7 returned the following primary sources:

- [discord.js gateway intents](https://github.com/discordjs/guide/blob/main/guide/popular-topics/intents.md): request the events/content needed; privileged intents require portal configuration. SameSection needs ordinary message content, but the join-button roster does not require the general member-events intent.
- [discord.js persistent component interactions](https://github.com/discordjs/guide/blob/main/guide/interactive-components/interactions.md): permanent buttons can route through `interactionCreate`; short-lived collectors are a different mechanism.
- [discord.js interaction response methods](https://github.com/discordjs/guide/blob/main/guide/slash-commands/response-methods.md): defer slow command responses and edit later.
- [Discord interaction requirements](https://docs.discord.com/developers/interactions/receiving-and-responding): initial interaction response within three seconds; tokens valid for 15 minutes. A button click is its own interaction; do not confuse its token with an earlier message's token.
- [Discord allowed mentions and message references](https://docs.discord.com/developers/resources/message): explicitly control intended user notifications and use structured reply references.

## Additional official checks

- [Discord bot setup guide](https://docs.discord.com/developers/quick-start/getting-started): application creation, installation and credentials. Its HTTP example is not a requirement to use that transport for this Gateway bot.
- [Discord Gateway lifecycle and Message Content Intent](https://docs.discord.com/developers/events/gateway): persistent WebSocket connection and content-access requirements.
- [Discord bot versus user account restrictions](https://docs.discord.com/developers/topics/oauth2#bot-vs-user-accounts): ordinary bot users cannot join Group DMs; use a server text channel.
- [discord.js documentation](https://discord.js.org/docs/packages/discord.js/main): the moving `main` documentation is not necessarily the released npm package contract. An npm metadata check returned release `14.27.0` with Node `>=18`, while `main` listed Node `24.17.0` or newer. Pin releases and consult their versioned documentation before implementing; choose a runtime satisfying all actual dependencies.

Do not copy extra intents, unrelated prefix commands, or destructive examples from retrieved snippets. Use the relevant documented behavior for SameSection's session and message workflow. Recheck version-sensitive SDK details when their implementation milestone begins.
