import { loadConfig, safeFailure } from '../src/config/index.js';
import { checkpointProbe, createPool } from '../src/persistence/database.js';
const pool = createPool(loadConfig());
try {
  const [id, marker] = process.argv.slice(2);
  if (!id || !marker) throw new Error('Missing probe identity.');
  const state = await checkpointProbe(pool).getState({ configurable: { thread_id: id } });
  if (state.values.marker !== marker) throw new Error('Persisted checkpoint did not survive a new process.');
  console.log('Checkpoint restored in a fresh Node process.');
} catch (error) { safeFailure('checkpoint-read', error); }
finally { await pool.end(); }
