import { loadConfig, safeFailure } from './config/index.js';
import { createPool } from './persistence/database.js';
import { PlanningApplication } from './application/planning.js';
import { PlanningStore } from './persistence/planning-store.js';
import { preferenceModel } from './model/preferences.js';
import { connectDiscord } from './transport/discord/index.js';
import { APIClient } from './integrations/api.js';

async function main() {
  const config = loadConfig();
  const pool = createPool(config);
  try {
    await pool.query('SELECT 1');
    await Promise.all([new APIClient(config.ASU_API_BASE_URL, config.API_TIMEOUT_MS).health(),
      new APIClient(config.RMP_API_BASE_URL, config.API_TIMEOUT_MS).health()]);
    const store = new PlanningStore(pool);
    await store.recover();
    const discord = config.DISCORD_BOT_TOKEN ? await connectDiscord(config,new PlanningApplication(store,preferenceModel(config),{ messages: config.PLANNING_MAX_MESSAGES, characters: config.PLANNING_MAX_CHARACTERS, participants: config.PLANNING_MAX_PARTICIPANTS })) : undefined;
    console.log(JSON.stringify({ service: 'Ray', milestone: 1, status: 'ready', discord_connected: Boolean(discord),
      note: discord ? 'Preference workflow enabled; course research remains disconnected.' : 'Configure Discord credentials and restart to connect.' }));
    const heartbeat = setInterval(() => console.log(JSON.stringify({ service: 'Ray', status: 'alive' })), 60000);
    const shutdown = async () => { clearInterval(heartbeat); discord?.destroy(); await pool.end(); process.exit(0); };
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  } catch (error) { await pool.end(); throw error; }
}
main().catch(error => safeFailure('worker', error));
