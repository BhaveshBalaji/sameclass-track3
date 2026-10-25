/** Opt-in live capability probe. Synthetic facts only; no Discord or university actions. */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { generateText, isStepCount, Output, tool } from 'ai';
import { z } from 'zod';
import { loadConfig, safeFailure } from '../src/config/index.js';
import { createModel, type ModelObservation } from '../src/model/openrouter.js';

let phase = 'extraction';
const observations: ModelObservation[] = [];
try {
  const config = loadConfig();
  const model = createModel(config, observations);
  const start = performance.now();
  const extraction = await generateText({ model, maxRetries: 0, maxOutputTokens: 2000,
    abortSignal: AbortSignal.timeout(config.MODEL_TIMEOUT_MS),
    output: Output.object({ schema: z.object({ participants: z.array(z.object({
      userId: z.string(), earliestWeekdayHour: z.number().nullable(),
      prefersMorning: z.boolean().nullable(), sourceMessageId: z.string(),
    })) }) }),
    prompt: 'Synthetic capability check. Extract ONLY author-owned facts, no assumptions. '
      + 'A preference is not a hard constraint. Unstated fields are null. '
      + 'm01 by maya: I cannot attend weekday classes before noon. '
      + 'm02 by leo: I prefer morning classes, but any weekday time is allowed. '
      + 'Return both participants with userId maya/leo and their source message IDs.' });
  const maya = extraction.output.participants.find(p => p.userId === 'maya');
  const leo = extraction.output.participants.find(p => p.userId === 'leo');
  assert.equal(extraction.output.participants.length, 2);
  assert.equal(maya?.earliestWeekdayHour, 12); assert.equal(maya?.sourceMessageId, 'm01');
  assert.equal(leo?.earliestWeekdayHour, null); assert.equal(leo?.prefersMorning, true);
  assert.equal(leo?.sourceMessageId, 'm02');
  phase = 'tool-roundtrip';
  let calls = 0;
  const roundtrip = await generateText({ model, maxRetries: 0, maxOutputTokens: 1500,
    abortSignal: AbortSignal.timeout(config.MODEL_TIMEOUT_MS), stopWhen: isStepCount(2),
    tools: { add_probe: tool({ description: 'Add two integers for a synthetic capability check only.',
      inputSchema: z.object({ a: z.number().int(), b: z.number().int() }),
      execute: async ({ a, b }) => { calls++; return { sum: a + b }; } }) },
    prepareStep: ({ stepNumber }) => stepNumber === 0
      ? { toolChoice: { type: 'tool', toolName: 'add_probe' } } : { activeTools: [] },
    output: Output.object({ schema: z.object({ sum: z.number().int() }) }),
    prompt: 'Use add_probe exactly once with a=13 and b=29. Then return its sum as structured output.' });
  assert.equal(calls, 1); assert.equal(roundtrip.output.sum, 42);
  phase = 'served-provider-and-model';
  assert.ok(observations.length >= 3);
  for (const observation of observations) {
    assert.equal(observation.provider?.toLowerCase(), config.OPENROUTER_PROVIDER);
    const accepted = [config.OPENROUTER_MODEL];
    if (config.OPENROUTER_MODEL === 'deepseek/deepseek-v4.1-flash-1017') {
      accepted.push('deepseek/deepseek-v4.1-flash-20261017');
    }
    assert.ok(observation.model && accepted.includes(observation.model));
  }
  console.log(JSON.stringify({ status: 'passed', model: config.OPENROUTER_MODEL, provider: config.OPENROUTER_PROVIDER,
    extraction: 'schema_and_author_facts_valid', tools: 'executed_once_and_returned_schema_valid_result',
    model_calls: observations.length, elapsed_ms: Math.round(performance.now() - start),
    input_tokens: (extraction.usage.inputTokens ?? 0) + (roundtrip.usage.inputTokens ?? 0),
    output_tokens: (extraction.usage.outputTokens ?? 0) + (roundtrip.usage.outputTokens ?? 0),
    reasoning_tokens: (extraction.usage.outputTokenDetails.reasoningTokens ?? 0) + (roundtrip.usage.outputTokenDetails.reasoningTokens ?? 0) }));
} catch (error) {
  console.error(JSON.stringify({ phase, calls: observations }));
  if (error instanceof assert.AssertionError) console.error(JSON.stringify({ phase, assertion: error.message }));
  safeFailure('live-model-capabilities', error);
}
