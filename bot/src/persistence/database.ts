import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { END, START, StateGraph, StateSchema } from '@langchain/langgraph';
import { z } from 'zod';
import { repoRoot, type Config } from '../config/index.js';

export function createPool(config: Config) {
  return new pg.Pool({ connectionString: config.DATABASE_URL, max: config.DB_POOL_MAX,
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, query_timeout: 15000,
    application_name: 'ray-bot' });
}
export function createCheckpointer(pool: pg.Pool) {
  return new PostgresSaver(pool, undefined, { schema: 'ray_checkpoints' });
}
export async function migrate(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(722900)');
    await client.query('CREATE SCHEMA IF NOT EXISTS ray_app');
    await client.query(`CREATE TABLE IF NOT EXISTS ray_app.schema_migrations
      (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const directory = join(repoRoot, 'bot/migrations');
    for (const name of (await readdir(directory)).filter(n => /^\d+_.*\.sql$/.test(n)).sort()) {
      const sql = await readFile(join(directory, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query('SELECT checksum FROM ray_app.schema_migrations WHERE name=$1', [name]);
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) throw new Error('An applied migration has changed; add a new migration instead.');
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO ray_app.schema_migrations(name,checksum) VALUES($1,$2)', [name, checksum]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
  } finally {
    try { await client.query('SELECT pg_advisory_unlock(722900)'); } finally { client.release(); }
  }
  // Version-pinned library migrations live in a separate schema and run only from this command.
  await createCheckpointer(pool).setup();
}
const ProbeState = new StateSchema({ marker: z.string() });
export function checkpointProbe(pool: pg.Pool) {
  return new StateGraph(ProbeState).addNode('persist', state => ({ marker: state.marker }))
    .addEdge(START, 'persist').addEdge('persist', END).compile({ checkpointer: createCheckpointer(pool) });
}
