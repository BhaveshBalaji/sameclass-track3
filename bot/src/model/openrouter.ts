import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { Config } from '../config/index.js';

export interface ModelObservation { provider?: string; model?: string; id?: string; finishReason?: string; contentChars?: number; toolCalls?: number }
export function modelRouting(config: Config) {
  return { only: [config.OPENROUTER_PROVIDER], allow_fallbacks: config.OPENROUTER_ALLOW_FALLBACKS,
    require_parameters: config.OPENROUTER_REQUIRE_PARAMETERS };
}
export function createModel(config: Config, observations: ModelObservation[] = [], request: typeof fetch = fetch) {
  if (!config.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required for the live model check.');
  const routing = modelRouting(config);
  const guardedFetch: typeof fetch = async (input, init) => {
    // A role/call-level override must never silently widen the configured provider allowlist.
    const body = JSON.parse(String(init?.body));
    if (body.model !== config.OPENROUTER_MODEL || JSON.stringify(body.provider) !== JSON.stringify(routing)) {
      throw new Error('Model request violates the configured routing policy.');
    }
    const response = await request(input, init);
    if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
      const metadata = await response.clone().json() as ModelObservation & { choices?: { finish_reason?: string; message?: { content?: string; tool_calls?: unknown[] } }[] };
      const first = metadata.choices?.[0];
      observations.push({ provider: metadata.provider, model: metadata.model, id: metadata.id,
        finishReason: first?.finish_reason, contentChars: first?.message?.content?.length ?? 0,
        toolCalls: first?.message?.tool_calls?.length ?? 0 });
    }
    return response;
  };
  const provider = createOpenRouter({ apiKey: config.OPENROUTER_API_KEY, fetch: guardedFetch,
    extraBody: { provider: routing, reasoning: { effort: config.OPENROUTER_REASONING_EFFORT } } });
  return provider(config.OPENROUTER_MODEL);
}
