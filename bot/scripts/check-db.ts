import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { loadConfig, repoRoot, safeFailure } from '../src/config/index.js';
import { checkpointProbe, createCheckpointer, createPool, migrate } from '../src/persistence/database.js';
const pool = createPool(loadConfig());
const thread = `milestone0:${randomUUID()}`, marker = randomUUID();
try {
  await migrate(pool); await migrate(pool);
  await pool.query(`INSERT INTO ray_app.runtime_metadata(name,value) VALUES($1,$2)
    ON CONFLICT(name) DO UPDATE SET value=excluded.value, updated_at=now()`, [thread, JSON.stringify({ marker })]);
  await checkpointProbe(pool).invoke({ marker }, { configurable: { thread_id: thread } });
  const child = spawnSync(process.execPath, ['--import', 'tsx', join(repoRoot, 'bot/scripts/checkpoint-read.ts'), thread, marker],
    { cwd: repoRoot, encoding: 'utf8' });
  if (child.status !== 0) throw new Error('Fresh-process checkpoint verification failed.');
  const row = await pool.query('SELECT value FROM ray_app.runtime_metadata WHERE name=$1', [thread]);
  if (row.rows[0]?.value.marker !== marker) throw new Error('App metadata persistence failed.');
  console.log(JSON.stringify({ database: 'ok', migrations: 'idempotent', checkpoint: 'restored_in_new_process' }));
} catch (error) { safeFailure('database-persistence', error); }
finally {
  await createCheckpointer(pool).deleteThread(thread);
  await pool.query('DELETE FROM ray_app.runtime_metadata WHERE name=$1', [thread]);
  await pool.end();
}
