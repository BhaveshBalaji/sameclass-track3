import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import { PlanningApplication } from '../src/application/planning.js';
import { PlanningStore } from '../src/persistence/planning-store.js';
import { fixture, fixtureLanguage, testDatabase, harness, baseScenario, continueScenario, cleanup, type Fixture } from '../scripts/replay-support.js';
import type { LanguageService, Patch } from '../src/domain/planning.js';
let pool: pg.Pool, data: Fixture;
const namespaces: string[] = [];
before(async () => { pool = await testDatabase(); data = await fixture(); });
after(async () => { for (const namespace of namespaces) await cleanup(pool,namespace); await pool.end(); });
function setup(language = fixtureLanguage().language) {
  const h = harness(pool,language); namespaces.push(h.namespace); return h;
}
test('four-student replay, silent participant, direct replies, correction and course question', async () => {
  const fake = fixtureLanguage(), h = setup(fake.language);
  await h.app.start(h.room,'start',data.actors[0]!,data.term); await h.drain();
  let state = (await h.store.read(h.room))!;
  for (const actor of data.actors) await h.app.membership(h.room,`join:${actor.userId}`,actor,state.id,true);
  await h.drain();
  for (const message of data.messages.slice(0,4)) await h.app.message({ ...h.room,...message });
  assert.deepEqual(fake.counts,{ classify: 0,extract: 0 });
  await h.app.message({ ...h.room,...data.messages[4]! }); await h.drain();
  state = (await h.store.read(h.room))!;
  assert.equal(fake.counts.extract,3);
  assert.equal(state.participants['test:nina']?.profile.facts.preferred_times?.strength,'soft');
  assert.equal(Object.keys(state.participants['test:dev']!.profile.facts).length,0);
  const pending = state.clarifications.find(q => q.userId === 'test:dev' && q.state === 'pending')!;
  assert.ok(pending.messageIds.length);
  const leoBefore = structuredClone(state.participants['test:leo']!.profile);
  await h.app.message({ ...h.room,...data.actors[1]!,id:'wrong-reply',content:'My times are unrestricted.',botMention:false,replyTo:pending.messageIds[0] });
  assert.equal(Object.keys((await h.store.read(h.room))!.participants['test:dev']!.profile.facts).length,0);
  assert.deepEqual(fake.counts,{ classify:1,extract:3 });
  await continueScenario(h,data);
  state = (await h.store.read(h.room))!;
  assert.equal(state.participants['test:dev']?.profile.facts.flexibility?.strength,'unrestricted');
  assert.equal(state.participants['test:dev']?.profile.facts.campus?.values[0],'Tempe');
  assert.deepEqual(state.participants['test:leo']!.profile,leoBefore);
  assert.deepEqual(state.participants['test:maya']?.profile.facts.unavailability?.values,['weekdays before noon','Tuesdays all day']);
  assert.equal(state.participants['test:nina']?.profile.facts.preferred_times?.values[0],'mornings');
  assert.deepEqual(state.participants['test:maya']!.profile.facts.unavailability!.sources.map(s => s.messageId),['test:m01','test:m08']);
  assert.equal(state.clarifications.filter(q => q.userId === 'test:dev' && q.field === 'participation').length,1);
});
test('duplicate events produce one state effect and one delivery, including after store reconstruction', async () => {
  const h = setup(); await baseScenario(h,data);
  const before = await h.store.read(h.room), count = h.delivered.length;
  const restarted = new PlanningApplication(new PlanningStore(pool,h.namespace),fixtureLanguage().language);
  await restarted.message({ ...h.room,...data.messages[4]! }); await h.drain(); await h.drain();
  assert.deepEqual(await h.store.read(h.room),before); assert.equal(h.delivered.length,count);
});
test('a newer message invalidates an in-flight result without losing the newer context', async () => {
  let started!: () => void, finish!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const pause = new Promise<void>(resolve => { finish = resolve; });
  const fake = fixtureLanguage();
  const language: LanguageService = { ...fake.language, async classify(text) { started(); await pause; return fake.language.classify(text); } };
  const h = setup(language);
  await h.app.start(h.room,'start',data.actors[0]!,data.term);
  const session = (await h.store.read(h.room))!;
  await h.app.membership(h.room,'join',data.actors[0]!,session.id,true);
  await h.app.message({ ...h.room,...data.messages[0]! });
  const pending = h.app.message({ ...h.room,...data.messages[4]! }); await entered;
  await h.app.message({ ...h.room,...data.actors[0]!,id:'newer',content:'Actually I cannot do Tuesdays.',botMention:false });
  finish(); await pending; await h.drain();
  const state = (await h.store.read(h.room))!;
  assert.equal(Object.keys(state.participants['test:maya']!.profile.facts).length,0);
  assert.ok(state.messages.some(m => m.id === 'newer'));
  assert.ok(h.delivered.some(m => /older results/.test(m.text)));
});
test('standalone ask never joins a session or changes stored profiles', async () => {
  const h = setup(); await baseScenario(h,data);
  const state = await h.store.read(h.room);
  await h.app.ask(h.room,'ask',{ userId:'test:outsider',name:'Outsider' },'What is CSE 575 about?'); await h.drain();
  assert.deepEqual(await h.store.read(h.room),state);
  assert.match(h.delivered.at(-1)!.text,/not connected/);
});
test('reset authorization, actor-bound confirmation, old buttons and source removal', async () => {
  const h = setup(); await baseScenario(h,data);
  const session = (await h.store.read(h.room))!;
  await assert.rejects(h.app.requestReset(h.room,'bad-reset',data.actors[1]!));
  await h.app.requestReset(h.room,'reset',data.actors[0]!);
  const token = (await h.store.read(h.room))!.resetConfirmation!.token;
  await assert.rejects(h.app.confirmReset(h.room,'wrong-user',data.actors[1]!,session.id,token));
  await h.app.resetProfile(h.room,'own-reset',data.actors[0]!);
  let state = (await h.store.read(h.room))!;
  assert.equal(Object.keys(state.participants['test:maya']!.profile.facts).length,0);
  assert.ok(!state.messages.some(m => m.authorId === 'test:maya'));
  assert.ok(state.participants['test:nina']!.profile.facts.preferred_times);
  await h.app.confirmReset(h.room,'confirm',data.actors[0]!,session.id,token);
  assert.equal(await h.store.read(h.room),null);
  await h.store.recover();
  await h.app.start(h.room,'next',data.actors[0]!,data.term);
  state = (await h.store.read(h.room))!;
  assert.notEqual(state.id,session.id);
  await assert.rejects(h.app.membership(h.room,'old-button',data.actors[0]!,session.id,true));
});
test('foreign or invented model source references cannot mutate a profile', async () => {
  const fake = fixtureLanguage();
  const h = setup({ ...fake.language, async extract() { return { facts: [{ field:'campus',strength:'hard',values:['Mars'],
    sources:[{messageId:'test:m02',quote:'invented'}] }] } satisfies Patch; } });
  await baseScenario(h,data);
  const state = (await h.store.read(h.room))!;
  for (const person of Object.values(state.participants)) assert.equal(Object.keys(person.profile.facts).length,0);
  assert.ok(h.delivered.some(m => /could not be validated/.test(m.text)));
});
test('uncertain delivery is not blindly retried after restart', async () => {
  const h = setup(); await h.app.start(h.room,'start',data.actors[0]!,data.term);
  let sends = 0;
  await h.store.deliver(h.room,async () => { sends++; throw new Error('simulated send uncertainty'); });
  await h.store.recover();
  await h.store.deliver(h.room,async () => { sends++; return 'unexpected'; });
  assert.equal(sends,1);
});

test('a stale undelivered participation question does not permanently suppress the silent student', async () => {
  const h = setup();
  await h.app.start(h.room,'start',data.actors[0]!,data.term); await h.drain();
  const session = (await h.store.read(h.room))!;
  for (const actor of data.actors) await h.app.membership(h.room,`join:${actor.userId}`,actor,session.id,true);
  await h.drain();
  for (const message of data.messages) await h.app.message({ ...h.room,...message });
  await h.app.message({ ...h.room,...data.actors[0]!,id:'new-context',content:'Thanks.',botMention:false });
  await h.drain();
  assert.equal((await h.store.read(h.room))!.participants['test:dev']!.silenceAsked,false);
  await h.app.message({ ...h.room,...data.messages[4]!,id:'refresh' }); await h.drain();
  const state = (await h.store.read(h.room))!;
  assert.equal(state.clarifications.filter(q => q.userId === 'test:dev' && q.field === 'participation').length,1);
  assert.ok(state.clarifications.find(q => q.userId === 'test:dev')!.messageIds.length);
});
