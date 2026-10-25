/** Manage only this repository's Compose database. Custom URLs are externally managed. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { config } from 'dotenv';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: resolve(root, '.env'), override: false, quiet: true });
const managedUrl = 'postgresql://ray:ray_local_only@127.0.0.1:55432/ray';
const url = process.env.DATABASE_URL || managedUrl;
if (url !== managedUrl) {
  console.log('Using externally managed DATABASE_URL; no local database was started or stopped.');
} else {
  const action = process.argv[2] || 'up';
  if (!['up', 'down'].includes(action)) throw new Error('Use up or down.');
  const result = spawnSync('docker', ['compose', ...(action === 'up' ? ['up', '-d', '--wait', 'postgres'] : ['stop', 'postgres'])],
    { cwd: root, stdio: 'inherit' });
  if (result.error) console.error('Docker is unavailable. Start Docker Desktop or configure an existing Postgres DATABASE_URL.');
  process.exitCode = result.status ?? 1;
}
