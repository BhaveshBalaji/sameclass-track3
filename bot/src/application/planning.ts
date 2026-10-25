import { ResearchMemory } from '../persistence/research-context.js';
import type { ResearchContext } from '../research/types.js';
import { semesterCode, semesterName } from '../domain/semester.js';
import { isCourseQuestion, type CourseResearch } from './catalog.js';
import { randomUUID } from 'node:crypto';
import { END, START, StateGraph, StateSchema } from '@langchain/langgraph';
import { z } from 'zod';
import { createCheckpointer } from '../persistence/database.js';
import { PlanningStore, response } from '../persistence/planning-store.js';
import { PlanningError, clean, missingQuestion, validatePatch, type Actor, type Incoming, type LanguageService,
  type Outgoing, type Participant, type PlanningSession, type Room, type Patch } from '../domain/planning.js';

export const processingNotice = 'Ray sends planning messages posted after you join to OpenRouter to understand your preferences. '
  + 'Join to include your messages; leave to stop.';
function requireSession(state: PlanningSession | null): PlanningSession {
  if (!state) throw new PlanningError('Start a planning session with /plan start first.');
  return state;
}
function summary(session: PlanningSession): string {
  const people = Object.values(session.participants).filter(p => p.active);
  const sections = people.map(person => {
    const facts = Object.values(person.profile.facts);
    return `${clean(person.name)}${facts.length ? '' : ' — preferences unknown'}\n`
      + facts.map(f => `• ${f.field.replace(/_/g,' ')} [${f.strength}]: ${clean(f.values.join('; ').slice(0,300))}`).join('\n');
  });
  return `Planning ${semesterName(session.term)} · ${people.length} joined\n\n${sections.join('\n\n')}\n\n`
    + (session.truncated ? 'Older conversation context was truncated; saved profile facts are retained.\n' : '')
    + 'Mention me with a course to check its instructors, meeting times and seats.';
}
export class PlanningApplication {
  constructor(readonly store: PlanningStore, private language: LanguageService,
    private limits = { messages: 100, characters: 30000, participants: 12 },
    private research?: CourseResearch) {}
  get memory(){return new ResearchMemory(this.store.pool,this.store.namespace);}
  async start(room: Room, eventId: string, actor: Actor, term: string): Promise<void> {
    term = semesterCode(term);
    await this.store.transact(room,eventId,async tx => {
      if (tx.state) throw new PlanningError('A session is already active in this channel.');
      tx.state = { id: randomUUID(), guildId: room.guildId, channelId: room.channelId, creatorId: actor.userId,
        term, version: 1, participants: {}, messages: [], nextOrdinal: 0, truncated: false, clarifications: [] };
      const body = response(`Planning for ${semesterName(term)}. ${processingNotice}`);
      body.buttons = ['join','leave'].map(action => ({ label: action === 'join' ? 'Join planning' : 'Leave planning',
        action: action as 'join' | 'leave', sessionId: tx.state!.id }));
      await tx.enqueue(body);
    });
  }
  async membership(room: Room, eventId: string, actor: Actor, sessionId: string, join: boolean): Promise<void> {
    await this.store.transact(room,eventId,async tx => {
      const state = requireSession(tx.state);
      if (state.id !== sessionId) throw new PlanningError('This planning button belongs to an old session.');
      const existing = state.participants[actor.userId];
      if (join) {
        if (!existing?.active && Object.values(state.participants).filter(p => p.active).length >= this.limits.participants) throw new PlanningError(`This session supports up to ${this.limits.participants} participants.`);
        if (existing?.active) { await tx.enqueue(response('You have already joined this session.')); return; }
        state.participants[actor.userId] = existing ? { ...existing, active: true, name: actor.name } : {
          userId: actor.userId, name: actor.name, active: true, profile: { version: 0, facts: {} }, silenceAsked: false, cursor: state.nextOrdinal };
      } else {
        if (existing) { existing.active = false; existing.cursor = state.nextOrdinal; }
        state.clarifications = state.clarifications.filter(q => q.userId !== actor.userId);
      }
      state.version++; delete state.currentRequest;
      await tx.enqueue(response(join ? 'You joined planning.' : 'You have left planning; your future messages will not be included.',[actor.userId]));
    });
  }
  async status(room: Room, eventId: string): Promise<void> {
    await this.store.transact(room,eventId,async tx => {
      await tx.enqueue(response(tx.state ? summary(tx.state) : 'No active session. Use /plan start to begin.'),Boolean(tx.state));
    });
  }
  async profile(room: Room, eventId: string, actor: Actor): Promise<void> {
    await this.store.transact(room,eventId,async tx => {
      const state = requireSession(tx.state), person = state.participants[actor.userId];
      if (!person?.active) throw new PlanningError('Join planning first to view your stored profile.');
      const own = structuredClone(state); own.participants = { [person.userId]: person };
      await tx.enqueue(response(summary(own),[actor.userId]),true);
    });
  }
  async resetProfile(room: Room, eventId: string, actor: Actor): Promise<void> {
    await this.store.transact(room,eventId,async tx => {
      const state = requireSession(tx.state), person = state.participants[actor.userId];
      if (!person?.active) throw new PlanningError('Join planning first.');
      person.profile = { version: person.profile.version + 1, facts: {} };
      person.cursor = state.nextOrdinal; person.silenceAsked = false;
      state.messages = state.messages.filter(m => m.authorId !== actor.userId);
      state.clarifications = state.clarifications.filter(q => q.userId !== actor.userId);
      state.version++; delete state.currentRequest;
      // Erase retained generated summaries which could contain the removed facts.
      await this.store.eraseResponses(tx,state.id);
      await tx.enqueue(response('Your stored profile and retained source messages have been reset.',[actor.userId]));
    });
    await this.memory.clear(room,actor.userId);
  }
  async requestReset(room: Room, eventId: string, actor: Actor): Promise<void> {
    await this.store.transact(room,eventId,async tx => {
      const state = requireSession(tx.state);
      if (actor.userId !== state.creatorId && !actor.moderator) throw new PlanningError('Only the session creator or a channel moderator can reset the session.');
      state.resetConfirmation = { actorId: actor.userId, token: randomUUID(), expiresAt: Date.now() + 300000 };
      const body = response('Confirm removing this session’s stored profiles, conversation context and clarifications.',[actor.userId]);
      body.buttons = [{ label: 'Confirm session reset', action: 'reset', sessionId: state.id, token: state.resetConfirmation.token, actorId: actor.userId }];
      await tx.enqueue(body);
    });
  }
  async confirmReset(room: Room, eventId: string, actor: Actor, sessionId: string, token: string): Promise<void> {
    await this.store.transact(room,eventId,async tx => {
      const state = requireSession(tx.state), confirmation = state.resetConfirmation;
      if (state.id !== sessionId || confirmation?.token !== token || confirmation.actorId !== actor.userId
          || confirmation.expiresAt < Date.now() || (state.creatorId !== actor.userId && !actor.moderator)) throw new PlanningError('Reset confirmation is invalid, expired or belongs to another student.');
      await this.store.eraseResponses(tx,state.id); tx.state = null;
      await tx.enqueue(response('Session reset. Use /plan start to begin a new session.'));
    });
    await this.memory.clear(room);
  }
  async ask(room: Room, eventId: string, actor: Actor, question: string, replyTo?:string, contextReplyTo?:string): Promise<void> {
    const claimed = await this.store.transact(room,eventId,async tx => ({ term:tx.state?.term }));
    if (claimed.duplicate) return;
    const prior=await this.memory.begin(room,actor.userId,contextReplyTo);
    const context:ResearchContext={turns:prior.turns};
    const text = await this.answerCourse(question,claimed.value?.term,context);
    await this.memory.finish(room,actor.userId,prior.version,prior.turns,{requestId:eventId,question:question.slice(0,2000),answer:text.slice(0,4000),
      tasks:context.result?.tasks??[],instructors:context.result?.instructors??[],sources:context.result?.sources??[]});
    await this.store.transact(room,`answer:${eventId}`,async tx => {
      await tx.enqueue({...response(text,[actor.userId]),requestId:eventId,replyTo});
    });
  }
  private answerCourse(question:string,term?:string,context?:ResearchContext):Promise<string> {
    return this.research ? this.research.answer(question,term,context)
      : Promise.resolve('Course research is not connected in this test environment.');
  }
  async message(event: Incoming): Promise<void> {
    if (event.bot || event.webhook) return;
    if (event.botMention || event.replyTo) {
      const session = await this.store.read(event);
      const direct = session?.clarifications.some(q => q.state === 'pending' && q.userId === event.userId && q.messageIds.includes(event.replyTo ?? ''));
      const researchReply=event.replyTo?await this.memory.referenced(event,event.replyTo):null;
      if (!direct && (researchReply || (event.botMention && (isCourseQuestion(event.content) || !session)))) {
        await this.ask(event,event.id,event,event.content,event.id,event.replyTo); return;
      }
    }
    const claimed = await this.store.transact(event,event.id,async tx => {
      const state = tx.state, participant = state?.participants[event.userId];
      const pending = state?.clarifications.find(q => q.state === 'pending' && q.userId === event.userId && q.messageIds.includes(event.replyTo ?? ''));
      if (!participant?.active && !event.botMention) return;
      if (participant?.active && state) {
        state.messages.push({ id: event.id, authorId: event.userId, content: event.content.slice(0,4000), ordinal: ++state.nextOrdinal });
        while (state.messages.length > this.limits.messages || state.messages.reduce((n,m) => n+m.content.length,0) > this.limits.characters) {
          state.messages.shift(); state.truncated = true;
        }
        state.version++;
      }
      if (!event.botMention && !pending) return;
      if (!state) { await tx.enqueue(response('This planning session has ended. Use /ask with a course and semester, or /plan start to begin planning.',[event.userId])); return; }
      const requestId = randomUUID(); state.currentRequest = requestId;
      return { requestId, snapshot: structuredClone(state), pendingId: pending?.id, participant: participant?.active ?? false };
    });
    const work = claimed.value;
    if (claimed.duplicate || !work) return;
    let intent: 'group_planning' | 'profile_update' | 'course_question' = 'group_planning';
    const patches: { userId: string; patch: Patch; cursor: number }[] = [], failed: string[] = [];
    const graphState = new StateSchema({ requestId: z.string(), status: z.string() });
    const graph = new StateGraph(graphState)
      .addNode('classify',async () => {
        intent = work.pendingId ? 'profile_update' : await this.language.classify(event.content);
        return { status: 'classified' };
      })
      .addNode('extract',async () => {
        if (intent === 'course_question' || !work.participant) return { status: 'no_profile_update' };
        const people = Object.values(work.snapshot.participants).filter(p => p.active && (intent !== 'profile_update' || p.userId === event.userId));
        // Sequential two-person batches bound model concurrency; no DB lock during model calls.
        for (let offset=0; offset<people.length; offset+=2) {
          await Promise.all(people.slice(offset,offset+2).map(async person => {
            const messages = work.snapshot.messages.filter(m => m.authorId === person.userId && m.ordinal > person.cursor && !m.ignored);
            if (!messages.length) return;
            const input = { userId: person.userId, profile: person.profile, messages };
            try {
              const patch = await this.language.extract(input); validatePatch(patch,input);
              patches.push({ userId: person.userId, patch, cursor: Math.max(...messages.map(m => m.ordinal)) });
            } catch { failed.push(person.userId); }
          }));
        }
        return { status: 'extracted' };
      }).addEdge(START,'classify').addEdge('classify','extract').addEdge('extract',END)
      .compile({ checkpointer: createCheckpointer(this.store.pool) });
    let modelFailed = false;
    try { await graph.invoke({ requestId: work.requestId, status: 'started' }, { configurable: { thread_id: `m1:${this.store.namespace}:${work.requestId}` } }); }
    catch { modelFailed = true; }
    const courseAnswer = !modelFailed && (intent as string) === 'course_question'
      ? await this.answerCourse(event.content,work.snapshot.term) : undefined;
    await this.store.transact(event,`finish:${work.requestId}`,async tx => {
      const enqueue = tx.enqueue;
      tx.enqueue = (body,guarded) => enqueue({...body,requestId:event.id,replyTo:event.id},guarded);
      const state = tx.state;
      if (!state || state.id !== work.snapshot.id) return;
      if (state.version !== work.snapshot.version || state.currentRequest !== work.requestId) {
        await tx.enqueue(response('New messages arrived while I was working. Mention me again for an updated summary.',[event.userId])); return;
      }
      delete state.currentRequest;
      if (modelFailed) { await tx.enqueue(response('I could not validate the model response. Your preferences were not changed; please try again.',[event.userId])); return; }
      if (intent === 'course_question') {
        const message = state.messages.find(m => m.id === event.id); if (message) message.ignored = true;
        await tx.enqueue(response(courseAnswer ?? 'Please include a course and semester.',[event.userId])); return;
      }
      if (!work.participant) { await tx.enqueue(response('Join planning before requesting a group preference summary. You can use /ask without joining.',[event.userId])); return; }
      for (const item of patches) {
        const person = state.participants[item.userId];
        if (!person?.active) continue;
        for (const fact of item.patch.facts) {
          // Keep the bounded evidence trail when a new patch revises an existing field.
          const previous = person.profile.facts[fact.field]?.sources ?? [];
          const sources = [...new Map([...previous,...fact.sources].map(source =>
            [JSON.stringify([source.messageId,source.quote]),source])).values()].slice(-12);
          person.profile.facts[fact.field] = { ...fact, sources };
        }
        if (item.patch.facts.length) person.profile.version++;
        person.cursor = item.cursor;
      }
      if (work.pendingId) {
        const question = state.clarifications.find(q => q.id === work.pendingId);
        if (question && !failed.includes(event.userId)) question.state = 'answered';
      }
      state.version++;
      const body = response(summary(state),[event.userId]);
      if (failed.length) body.text += `\nSome profiles could not be validated: ${failed.map(id => clean(state.participants[id]?.name ?? id)).join(', ')}. Their previous facts were retained.`;
      for (const person of Object.values(state.participants).filter(p => p.active)) {
        if (state.clarifications.some(q => q.userId === person.userId && q.state === 'pending')) continue;
        const missing = missingQuestion(person); if (!missing) continue;
        const question = { id: randomUUID(), userId: person.userId, ...missing, state: 'pending' as const, responseId: body.id, messageIds: [] };
        state.clarifications.push(question); if (missing.field === 'participation') person.silenceAsked = true;
        body.clarificationIds.push(question.id); body.mentions.push(person.userId);
        body.text += `\n\n${clean(person.name)}: ${missing.question} Reply directly to this message; no new mention is needed.`;
      }
      await tx.enqueue(body,true);
    });
  }
}
