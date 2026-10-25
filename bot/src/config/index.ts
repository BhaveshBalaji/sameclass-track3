import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenv } from 'dotenv';
import { z } from 'zod';

function findRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  while (true) {
    const file = join(directory, 'package.json');
    if (existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).name === 'ray-track3') return directory;
    const parent = dirname(directory);
    if (parent === directory) throw new Error('Cannot locate the Ray repository.');
    directory = parent;
  }
}
export const repoRoot = findRoot();
const boolean = (fallback: string) => z.enum(['true', 'false']).default(fallback as 'true' | 'false').transform(v => v === 'true');
const httpUrl = z.url().refine(value => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}, 'Expected an HTTP(S) base URL without credentials, query or fragment').transform(v => v.replace(/\/+$/, ''));
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url().default('postgresql://ray:ray_local_only@127.0.0.1:55432/ray')
    .refine(v => { try { return ['postgres:', 'postgresql:'].includes(new URL(v).protocol); } catch { return false; } }, 'Expected a Postgres URL'),
  ASU_API_BASE_URL: httpUrl.default('http://127.0.0.1:8000'),
  RMP_API_BASE_URL: httpUrl.default('http://127.0.0.1:8001'),
  API_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(10000),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(10).default(3),
  OPENROUTER_API_KEY: z.string().trim().default(''),
  OPENROUTER_MODEL: z.string().min(1).default('deepseek/deepseek-v4.1-flash-1017'),
  OPENROUTER_PROVIDER: z.string().regex(/^[a-z0-9/-]+$/).default('relace'),
  OPENROUTER_ALLOW_FALLBACKS: boolean('false'),
  OPENROUTER_REQUIRE_PARAMETERS: boolean('true'),
  OPENROUTER_REASONING_EFFORT: z.enum(['none', 'low', 'high', 'max']).default('none'),
  MODEL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(45000),
  PLANNING_MAX_CANDIDATES:z.coerce.number().int().min(1).max(12).default(12),
  PLANNING_RESEARCH_SHORTLIST:z.coerce.number().int().min(0).max(6).default(4),
  PLANNING_TIMEOUT_MS:z.coerce.number().int().min(10000).max(120000).default(90000),
  PLANNING_MAX_MESSAGES: z.coerce.number().int().min(10).max(500).default(100),
  PLANNING_MAX_CHARACTERS: z.coerce.number().int().min(4000).max(100000).default(30000),
  PLANNING_MAX_PARTICIPANTS: z.coerce.number().int().min(1).max(12).default(12),
  RESEARCH_MAX_INPUT_CHARS: z.coerce.number().int().min(10000).max(160000).default(100000),
  RESEARCH_MAX_TASKS: z.coerce.number().int().min(1).max(12).default(12),
  RESEARCH_MAX_SOURCE_CALLS: z.coerce.number().int().min(1).max(60).default(24),
  RESEARCH_MAX_MODEL_CALLS: z.coerce.number().int().min(3).max(32).default(18),
  RESEARCH_REVIEW_MAX_PAGES: z.coerce.number().int().min(1).max(30).default(20),
  RESEARCH_WORKER_STEPS: z.coerce.number().int().min(1).max(4).default(4),
  RESEARCH_WORKER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(20000),
  RESEARCH_TOTAL_TIMEOUT_MS: z.coerce.number().int().min(10000).max(120000).default(90000),
  RESEARCH_GLOBAL_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(4),
  RESEARCH_SOURCE_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
  RESEARCH_MAX_SECTIONS: z.coerce.number().int().min(1).max(12).default(12),
  RESEARCH_SEAT_CACHE_MS: z.coerce.number().int().min(0).max(120000).default(120000),
  RESEARCH_EVIDENCE_CACHE_MS: z.coerce.number().int().min(0).max(86400000).default(86400000),
  DISCORD_BOT_TOKEN: z.string().default(''),
  DISCORD_APPLICATION_ID: z.string().default(''),
  DISCORD_GUILD_ID: z.string().default(''),
  DISCORD_PLANNING_CHANNEL_IDS: z.string().default(''),
});
export type Config = z.infer<typeof schema>;
export class ConfigurationError extends Error { constructor(message: string) { super(message); this.name = 'ConfigurationError'; } }
export function parseConfig(env: Record<string, string | undefined>): Config {
  if (env.NODE_ENV === 'production') {
    const required = ['DATABASE_URL', 'ASU_API_BASE_URL', 'RMP_API_BASE_URL'].filter(key => !env[key]?.trim());
    if (required.length) throw new ConfigurationError(`Missing production configuration: ${required.join(', ')}`);
  }
  const result = schema.safeParse(env);
  if (!result.success) throw new ConfigurationError(`Invalid configuration: ${[...new Set(result.error.issues.map(i => i.path.join('.')))].join(', ')}`);
  return result.data;
}
export function loadConfig(): Config {
  dotenv({ path: join(repoRoot, '.env'), override: false, quiet: true });
  return parseConfig(process.env);
}
export function safeFailure(context: string, error: unknown): void {
  // Never print upstream request/response objects, DB URLs, tokens, or reasoning.
  const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
  console.error(JSON.stringify({ status: 'failed', check: context, type: error instanceof Error ? error.name : 'Error',
    ...(typeof status === 'number' ? { http_status: status } : {}),
    ...(error instanceof ConfigurationError ? { message: error.message } : {}) }));
  process.exitCode = 1;
}
