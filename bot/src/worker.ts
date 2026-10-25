import { loadConfig, safeFailure } from './config/index.js';
import { createPool } from './persistence/database.js';
import { APIClient } from './integrations/api.js';

async function main() {
  const config = loadConfig();
  const pool = createPool(config);
  try {
    await pool.query('SELECT 1');
    await Promise.all([new APIClient(config.ASU_API_BASE_URL, config.API_TIMEOUT_MS).health(),
      new APIClient(config.RMP_API_BASE_URL, config.API_TIMEOUT_MS).health()]);
  } catch (error) { await pool.end(); throw error; }
  console.log(JSON.stringify({ service: 'Ray', milestone: 0, status: 'ready', discord_connected: false,
    note: 'Foundation worker only. Discord interaction workflow begins in Milestone 1.' }));
  const heartbeat = setInterval(() => console.log(JSON.stringify({ service: 'Ray', status: 'alive' })), 60000);
  const shutdown = async () => { clearInterval(heartbeat); await pool.end(); process.exit(0); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
main().catch(error => safeFailure('worker', error));
