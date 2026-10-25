/** Local database, APIs and Ray Gateway worker; host URLs remain configurable. */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: resolve(root, '.env'), override: false, quiet: true });
const children = [];
let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  const force = setTimeout(() => {
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  }, 5000);
  force.unref(); process.exitCode = code;
}
function run(program, args) {
  const child = spawn(program, args, { cwd: root, stdio: 'inherit' }); children.push(child);
  child.once('error', () => { console.error('A required local process could not start.'); shutdown(1); });
  child.once('exit', code => { if (!stopping) shutdown(code || 1); });
  return child;
}
async function ready(base) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (stopping) throw new Error('Local process exited.');
    try {
      const response = await fetch(`${base.replace(/\/+$/, '')}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.json()).status === 'ok') return;
    } catch { /* Retry only startup readiness, never source/model work. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('API health check did not become ready.');
}
try {
  const python = resolve(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!existsSync(python)) throw new Error('Create .venv and install requirements.txt first.');
  const db = spawnSync(process.execPath, ['scripts/database.mjs', 'up'], { cwd: root, stdio: 'inherit' });
  if (db.status !== 0) throw new Error('Database startup failed.');
  const migrations = spawnSync(process.execPath, ['--import', 'tsx', 'bot/scripts/migrate.ts'], { cwd: root, stdio: 'inherit' });
  if (migrations.status !== 0) throw new Error('Database initialization failed.');
  // For custom/deployed URLs, those services are externally managed.
  const asu = process.env.ASU_API_BASE_URL || 'http://127.0.0.1:8000';
  const rmp = process.env.RMP_API_BASE_URL || 'http://127.0.0.1:8001';
  for (const [base, app, port] of [[asu, 'class_search_api.server:app', '8000'], [rmp, 'rmp_api.server:app', '8001']]) {
    if (base === `http://127.0.0.1:${port}`) run(python, ['-m', 'uvicorn', app, '--host', '127.0.0.1', '--port', port]);
  }
  await Promise.all([ready(asu), ready(rmp)]);
  if (!stopping) run(process.execPath, ['--import', 'tsx', 'bot/src/worker.ts']);
} catch (error) { console.error(error instanceof Error ? error.message : 'Local startup failed.'); shutdown(1); }
process.once('SIGINT', () => shutdown());
process.once('SIGTERM', () => shutdown());
