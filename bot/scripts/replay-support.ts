import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type pg from 'pg';
import { loadConfig, repoRoot } from '../src/config/index.js';
import { createPool, migrate, createCheckpointer } from '../src/persistence/database.js';
import { PlanningStore } from '../src/persistence/planning-store.js';
import { PlanningApplication } from '../src/application/planning.js';
import type { Field, Fact, Incoming, LanguageService, Patch, PlanningSession } from '../src/domain/planning.js';

export interface Fixture {
  term: string; actors: {userId: string;name: string}[];
  messages: Omit<Incoming,'guildId'|'channelId'>[];
  continuations: (Omit<Incoming,'guildId'|'channelId'|'botMention'> & {botMention?: boolean;replyFor?: string})[];
}
export async function fixture(): Promise<Fixture> {
  return JSON.parse(await readFile(join(repoRoot,'bot/test-data/conversations/four-students.json'),'utf8'));
}
export async function testDatabase(): Promise<pg.Pool> {
  const config = loadConfig(), url = new URL(process.env.RAY_TEST_DATABASE_URL || config.DATABASE_URL);
  if (config.NODE_ENV === 'production') throw new Error('Replay is disabled in production.');
  if (!process.env.RAY_TEST_DATABASE_URL) {
    if (!['127.0.0.1','localhost'].includes(url.hostname)) throw new Error('Set an explicit isolated RAY_TEST_DATABASE_URL for remote replay.');
    const admin = createPool(config);
    try {
      if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',['ray_m1_test'])).rowCount) {
        await admin.query('CREATE DATABASE ray_m1_test');
      }
    } finally { await admin.end(); }
    url.pathname = '/ray_m1_test';
  }
  if (!url.pathname.toLowerCase().includes('test')) throw new Error('Replay database name must identify test storage.');
  const pool = createPool({ ...config,DATABASE_URL: url.toString() });
  await migrate(pool); return pool;
}
export async function cleanup(pool: pg.Pool, namespace: string) {
  await pool.query('DELETE FROM ray_app.research_context WHERE namespace=$1',[namespace]);
  await pool.query('DELETE FROM ray_app.research_replies WHERE namespace=$1',[namespace]);
  await pool.query('DELETE FROM ray_app.planning_rooms WHERE namespace=$1',[namespace]);
  const checkpoints = await pool.query('SELECT DISTINCT thread_id FROM ray_checkpoints.checkpoints WHERE thread_id LIKE $1',[`m1:${namespace}:%`]);
  for (const row of checkpoints.rows) await createCheckpointer(pool).deleteThread(row.thread_id);
}
export function fixtureLanguage() {
  const counts = { classify: 0, extract: 0 };
  const language: LanguageService = {
    async classify(text) { counts.classify++; return /what is|syllabus|who teaches/i.test(text) ? 'course_question' : 'group_planning'; },
    async extract(input) {
      counts.extract++;
      const facts: Fact[] = [];
      const add = (field: Field, values: string[], strength: Fact['strength'], id: string) => {
        const message = input.messages.find(m => m.id === id)!;
        facts.push({ field, values, strength, sources: [{ messageId: id, quote: message.content }] });
      };
      for (const m of input.messages) {
        if (['test:m01','test:m02','test:m03'].includes(m.id)) {
          add('credits',['3'],'hard',m.id); add('campus',['Tempe'],'hard',m.id);
          add('approved_courses',m.id === 'test:m02' ? ['CSE 512','CSE 575'] : ['CSE 511','CSE 512'],'hard',m.id);
          add('unavailability',[m.id === 'test:m01' ? 'weekdays before noon' : m.id === 'test:m02' ? 'Tuesday/Thursday 14:00-18:00' : 'Monday/Wednesday after 16:00'],'hard',m.id);
          if (m.id === 'test:m03') add('preferred_times',['mornings'],'soft',m.id);
        } else if (m.id === 'test:m06') {
          add('flexibility',['any weekday time'],'unrestricted',m.id); add('requirement',['database elective'],'hard',m.id);
        } else if (m.id === 'test:m07') {
          add('approved_courses',['CSE 511','CSE 512'],'hard',m.id); add('credits',['3'],'hard',m.id); add('campus',['Tempe'],'hard',m.id);
        } else if (m.id === 'test:m08') {
          add('unavailability',[...(input.profile.facts.unavailability?.values ?? []),'Tuesdays all day'],'hard',m.id);
        }
      }
      return { facts } satisfies Patch;
    },
  };
  return { language,counts };
}
export function harness(pool: pg.Pool, language: LanguageService, namespace = `test:${randomUUID()}`) {
  const store = new PlanningStore(pool,namespace), app = new PlanningApplication(store,language);
  const room = { guildId: 'test:guild', channelId: 'test:channel' };
  const delivered: {id: string;text: string;mentions: string[]}[] = [];
  const drain = () => store.deliver(room,async (body,part,content) => {
    const id = `test:reply:${body.id}:${part}`;
    delivered.push({ id,text: content,mentions: body.mentions }); return id;
  });
  return { app,store,room,delivered,drain,namespace };
}
export async function baseScenario(h: ReturnType<typeof harness>, data: Fixture) {
  await h.app.start(h.room,'test:start',data.actors[0]!,data.term); await h.drain();
  const session = (await h.store.read(h.room))!;
  for (const actor of data.actors) await h.app.membership(h.room,`test:join:${actor.userId}`,actor,session.id,true);
  await h.drain();
  for (const message of data.messages) await h.app.message({ ...h.room,...message });
  await h.drain();
}
export async function continueScenario(h: ReturnType<typeof harness>, data: Fixture) {
  for (const message of data.continuations) {
    let replyTo: string | undefined;
    if (message.replyFor) {
      const state = (await h.store.read(h.room))!;
      replyTo = state.clarifications.find(q => q.userId === message.replyFor && q.state === 'pending')?.messageIds[0];
      if (!replyTo) throw new Error('Expected a delivered pending clarification.');
    }
    await h.app.message({ ...h.room,...message,botMention: message.botMention ?? false,replyTo }); await h.drain();
  }
}
export function profileFacts(state: PlanningSession, userId: string) {
  return state.participants[userId]?.profile.facts;
}
