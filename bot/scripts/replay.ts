import assert from 'node:assert/strict';
import { loadConfig, safeFailure } from '../src/config/index.js';
import { preferenceModel } from '../src/model/preferences.js';
import { fixture, fixtureLanguage, testDatabase, harness, baseScenario, continueScenario, cleanup } from './replay-support.js';
let pool: Awaited<ReturnType<typeof testDatabase>> | undefined;
let namespace: string | undefined;
try {
  const live = process.argv.includes('--live');
  pool = await testDatabase();
  const mocked = fixtureLanguage(), h = harness(pool,live ? preferenceModel(loadConfig()) : mocked.language);
  namespace = h.namespace;
  const data = await fixture();
  await baseScenario(h,data);
  const base = (await h.store.read(h.room))!;
  assert.equal(Object.keys(base.participants).length,4);
  assert.equal(base.participants['test:maya']?.profile.facts.unavailability?.strength,'hard');
  assert.equal(base.participants['test:nina']?.profile.facts.preferred_times?.strength,'soft');
  assert.equal(Object.keys(base.participants['test:dev']!.profile.facts).length,0);
  assert.equal(base.clarifications.filter(q => q.userId === 'test:dev' && q.state === 'pending').length,1);
  await continueScenario(h,data);
  const final = (await h.store.read(h.room))!;
  assert.equal(final.participants['test:dev']?.profile.facts.flexibility?.strength,'unrestricted');
  assert.ok(final.participants['test:dev']?.profile.facts.approved_courses);
  assert.match(final.participants['test:maya']?.profile.facts.unavailability?.values.join(' ') ?? '',/tuesday/i);
  assert.deepEqual(final.participants['test:nina']!.profile,base.participants['test:nina']!.profile);
  assert.deepEqual(final.participants['test:leo']!.profile,base.participants['test:leo']!.profile);
  assert.ok(final.participants['test:maya']!.profile.facts.unavailability!.sources.some(s => s.messageId === 'test:m01'));
  assert.ok(final.participants['test:maya']!.profile.facts.unavailability!.sources.some(s => s.messageId === 'test:m08'));
  console.log(JSON.stringify({ status: 'passed', mode: live ? 'synthetic_students_live_openrouter' : 'deterministic_model_fixture',
    participants: 4, direct_replies: 'routed', author_correction: 'preserved', individual_question: 'no_profile_mutation',
    discord_transport: 'not_exercised', course_research: 'disconnected', ...(live ? {} : { model_stub_calls: mocked.counts }) }));
} catch (error) {
  if (error instanceof assert.AssertionError) console.error(JSON.stringify({ assertion: error.message }));
  safeFailure('planning-replay',error);
} finally {
  if (pool) { if (namespace) await cleanup(pool,namespace); await pool.end(); }
}
