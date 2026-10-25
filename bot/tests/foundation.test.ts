import test from 'node:test';
import assert from 'node:assert/strict';
import { generateText } from 'ai';
import { z } from 'zod';
import { parseConfig } from '../src/config/index.js';
import { APIClient, APIError } from '../src/integrations/api.js';
import { createModel, modelRouting } from '../src/model/openrouter.js';

const config = parseConfig({ OPENROUTER_API_KEY: 'test-only-not-a-real-key' });
test('configuration defaults preserve Relace-only routing and false stays false', () => {
  assert.equal(config.OPENROUTER_ALLOW_FALLBACKS, false);
  assert.deepEqual(modelRouting(config), { only: ['relace'], allow_fallbacks: false, require_parameters: true });
  assert.equal(parseConfig({ OPENROUTER_ALLOW_FALLBACKS: 'true' }).OPENROUTER_ALLOW_FALLBACKS, true);
});
test('invalid config identifies fields without leaking input values', () => {
  assert.throws(() => parseConfig({ DATABASE_URL: 'secret-invalid-db', API_TIMEOUT_MS: 'oops' }),
    error => error instanceof Error && error.message.includes('DATABASE_URL') && !error.message.includes('secret-invalid-db'));
  assert.throws(() => parseConfig({ ASU_API_BASE_URL: 'https://user:secret@example.test' }));
  assert.throws(() => parseConfig({ OPENROUTER_ALLOW_FALLBACKS: 'maybe' }));
});
test('HTTP adapter keeps deployment base prefixes and encodes query values', async () => {
  let observed: URL | undefined;
  const request: typeof fetch = async input => {
    observed = new URL(String(input));
    return Response.json({ ok: true });
  };
  const client = new APIClient('https://backend.test/asu/', 1000, request);
  await client.get('/api/search', z.object({ ok: z.boolean() }), { instructor: 'Ada & Leo' });
  assert.equal(observed?.pathname, '/asu/api/search');
  assert.equal(observed?.searchParams.get('instructor'), 'Ada & Leo');
  await assert.rejects(client.get('https://untrusted.test', z.unknown()));
});
test('adapter distinguishes source HTTP failure, malformed response and timeout', async () => {
  const http: typeof fetch = async () => new Response('sensitive upstream body', { status: 503 });
  await assert.rejects(new APIClient('https://backend.test', 1000, http).health(),
    error => error instanceof APIError && error.status === 503 && !error.message.includes('sensitive'));
  await assert.rejects(new APIClient('https://backend.test', 1000, async () => Response.json({ wrong: true })).health(),
    error => error instanceof APIError && error.kind === 'invalid_response');
  await assert.rejects(new APIClient('https://backend.test', 1000, async () => { throw new DOMException('timeout', 'TimeoutError'); }).health(),
    error => error instanceof APIError && error.kind === 'timeout');
});
function reply() {
  return Response.json({ id: 'probe', provider: 'Relace', model: config.OPENROUTER_MODEL,
    object: 'chat.completion', created: 1, choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } });
}
test('actual SDK wire request includes the exact model, provider pin and reasoning policy', async () => {
  let body: Record<string, unknown> | undefined;
  const result = await generateText({ model: createModel(config, [], async (_input, init) => {
    body = JSON.parse(String(init?.body)); return reply();
  }), prompt: 'synthetic probe', maxRetries: 0 });
  assert.equal(result.text, 'ok'); assert.equal(body?.model, config.OPENROUTER_MODEL);
  assert.deepEqual(body?.provider, modelRouting(config));
  assert.deepEqual(body?.reasoning, { effort: 'none' });
  assert.equal(body?.tools, undefined); assert.equal(body?.tool_choice, undefined);
});
test('call-level provider overrides cannot escape the routing policy', async () => {
  let sent = false;
  await assert.rejects(generateText({ model: createModel(config, [], async () => { sent = true; return reply(); }),
    prompt: 'probe', maxRetries: 0, providerOptions: { openrouter: { provider: { only: ['other-provider'] } } } }));
  assert.equal(sent, false);
});

test('production requires explicit service configuration rather than local defaults', () => {
  assert.throws(() => parseConfig({ NODE_ENV: 'production' }), /Missing production configuration/);
  const production = parseConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://user:password@db.test/ray',
    ASU_API_BASE_URL: 'https://backend.test/asu/', RMP_API_BASE_URL: 'https://backend.test/rmp/' });
  assert.equal(production.ASU_API_BASE_URL, 'https://backend.test/asu');
  assert.equal(production.RMP_API_BASE_URL, 'https://backend.test/rmp');
});
