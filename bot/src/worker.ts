import { loadConfig, safeFailure } from './config/index.js';
import { createPool } from './persistence/database.js';
import { PlanningApplication } from './application/planning.js';
import { PlanningStore } from './persistence/planning-store.js';
import { preferenceModel } from './model/preferences.js';
import { connectDiscord } from './transport/discord/index.js';
import { CatalogClient } from './integrations/catalog.js';
import { CatalogResearch } from './application/catalog.js';
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
    const research = new CatalogResearch(new CatalogClient(new APIClient(config.ASU_API_BASE_URL,config.API_TIMEOUT_MS)));
    const application = config.DISCORD_BOT_TOKEN ? new PlanningApplication(store,preferenceModel(config),{
      messages: config.PLANNING_MAX_MESSAGES, characters: config.PLANNING_MAX_CHARACTERS,
      participants: config.PLANNING_MAX_PARTICIPANTS,
    },research) : undefined;
    const discord = application ? await connectDiscord(config,application) : undefined;
    console.log(discord ? 'Ray is online. Planning and course lookups are ready.' : 'Ray is ready. Configure Discord credentials to connect.');
    // Foundation mode also stays running, without periodic log chatter.
    const idle = discord ? undefined : setInterval(() => {},60000);
    const shutdown = async () => { clearInterval(idle); discord?.destroy(); await pool.end(); process.exit(0); };
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  } catch (error) { await pool.end(); throw error; }
}
main().catch(error => safeFailure('worker', error));
