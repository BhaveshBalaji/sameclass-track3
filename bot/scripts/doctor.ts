import { loadConfig, safeFailure } from '../src/config/index.js';
import { APIClient } from '../src/integrations/api.js';
import { createPool } from '../src/persistence/database.js';
try {
  const config = loadConfig();
  const pool = createPool(config);
  try {
    await pool.query('SELECT 1');
    const checks = await Promise.all([new APIClient(config.ASU_API_BASE_URL, config.API_TIMEOUT_MS).health(),
      new APIClient(config.RMP_API_BASE_URL, config.API_TIMEOUT_MS).health()]);
    console.log(JSON.stringify({ database: 'ok', apis: checks.map(v => ({ service: v.service, status: v.status })),
      openrouter_key_configured: Boolean(config.OPENROUTER_API_KEY),
      discord_configured: Boolean(config.DISCORD_BOT_TOKEN && config.DISCORD_APPLICATION_ID && config.DISCORD_GUILD_ID),
      milestone: 0, discord_connected: false }));
  } finally { await pool.end(); }
} catch (error) { safeFailure('doctor', error); }
