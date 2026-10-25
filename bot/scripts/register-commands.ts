import { loadConfig, safeFailure } from '../src/config/index.js';
import { registerCommands } from '../src/transport/discord/commands.js';
try { await registerCommands(loadConfig()); console.log('Ray commands registered for the configured development guild.'); }
catch (error) { safeFailure('register-commands',error); }
