import {isGroupRequest} from '../planning/engine.js';
import type {GroupPlanner,Recommendation} from '../planning/types.js';
import {roomId} from '../persistence/planning-store.js';
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
  type Outgoing, type Fact, type Participant, type PlanningSession, type Room, type Patch } from '../domain/planning.js';

export const processingNotice = 'Ray sends planning messages posted after you join to OpenRouter to understand your preferences. '
  + 'Join to include your messages; leave to stop.';
function requireSession(state: PlanningSession | null): PlanningSession {
  if (!state) throw new PlanningError('Start a planning session with /plan start first.');
  return state;
}
function summary(session: PlanningSession,own=false): string {
  const people = Object.values(session.participants).filter(p => p.active || own);
  const sections = people.map(person => {
    const facts = Object.values(person.profile.facts).filter((f):f is Fact=>Boolean(f));
    return `${clean(person.name)}${facts.length ? '' : ' — preferences unknown'}\n`
      + facts.map(f => `• ${f.field.replace(/_/g,' ')} [${f.strength}]: ${clean(f.values.join('; ').slice(0,300))}`).join('\n');
  });
  return `${own?'Your planning profile':'Planning'} ${(session.term?semesterName(session.term):'semester not selected')}${own?'':` · ${people.length} joined`}\n\n${sections.join('\n\n')}\n\n`
    + (session.truncated ? 'Older conversation context was truncated; saved profile facts are retained.\n' : '')
    + 'Mention me with a course to check its instructors, meeting times and seats.';
}
function attachQuestions(state:PlanningSession,body:Outgoing,discovery=false,failed:string[]=[]){
  for(const person of Object.values(state.participants).filter(p=>p.active)){
    // Failed extraction is not silence. Optional fields do not gate preliminary discovery.
    if(failed.includes(person.userId))continue;
    if(discovery&&(Object.keys(person.profile.facts).length||state.messages.some(m=>m.authorId===person.userId&&!m.ignored)))continue;
    if(state.clarifications.some(q=>q.userId===person.userId&&q.state==='pending'))continue;
    const missing=missingQuestion(person);if(!missing)continue;
    const q={id:randomUUID(),userId:person.userId,...missing,state:'pending' as const,responseId:body.id,messageIds:[]};
    state.clarifications.push(q);if(missing.field==='participation')person.silenceAsked=true;
    body.clarificationIds.push(q.id);body.mentions.push(person.userId);
    body.text+=`\n\n**${clean(person.name)}:** ${missing.question} Reply directly to answer.`;
  }
}
export class PlanningApplication {
  constructor(readonly store: PlanningStore, private language: LanguageService,
    private limits = { messages: 100, characters: 30000, participants: 12 },
    private research?: CourseResearch,private groupPlanner?:GroupPlanner) {}
  private activePlans=new Map<string,AbortController>();
  private cancelPlan(room:Room){this.activePlans.get(roomId(room))?.abort();this.activePlans.delete(roomId(room));}
  get memory(){return new ResearchMemory(this.store.pool,this.store.namespace);}
  async start(room: Room, eventId: string, actor: Actor, term: string): Promise<void> {
    term = semesterCode(term);
    await this.store.transact(room,eventId,async tx => {
      if (tx.state && !tx.state.voiceOnly) throw new PlanningError('A session is already active in this channel.');
      if(tx.state){tx.state.voiceOnly=false;tx.state.term=term;tx.state.version++;}
      tx.state ??= { id: randomUUID(), guildId: room.guildId, channelId: room.channelId, creatorId: actor.userId,
        term, version: 1, participants: {}, messages: [], nextOrdinal: 0, truncated: false, clarifications: [] };
      const body = response(`Planning for ${semesterName(term)}. ${processingNotice}`);
      body.buttons = ['join','leave'].map(action => ({ label: action === 'join' ? 'Join planning' : 'Leave planning',
        action: action as 'join' | 'leave', sessionId: tx.state!.id }));
      await tx.enqueue(body);
    });
  }
  async voiceParticipant(room:Room,actor:Actor):Promise<PlanningSession>{
    const result=await this.store.transact(room,`voice-join:${randomUUID()}`,async tx=>{
      tx.state??={id:randomUUID(),...room,creatorId:actor.userId,term:'',voiceOnly:true,version:1,
        participants:{},messages:[],nextOrdinal:0,truncated:false,clarifications:[]};
      const state=tx.state;
      if(!state.participants[actor.userId]){
        if(Object.keys(state.participants).length>=this.limits.participants)throw new PlanningError('This voice workspace is full.');
        state.participants[actor.userId]={...actor,active:false,profile:{version:0,facts:{}},silenceAsked:false,cursor:state.nextOrdinal};
        state.version++;
      }
      state.participants[actor.userId]!.name=actor.name;
      state.participants[actor.userId]!.voice=true;
      return structuredClone(state);
    });
    return result.value!;
  }
  async membership(room: Room, eventId: string, actor: Actor, sessionId: string, join: boolean): Promise<void> {
    await this.store.transact(room,eventId,async tx => {
      const state = requireSession(tx.state);
      if (state.id !== sessionId) throw new PlanningError('This planning button belongs to an old session.');
      if(join&&state.voiceOnly)throw new PlanningError('Choose a semester with /plan start before joining planning.');
      const existing = state.participants[actor.userId];
      if (join) {
        if (!existing?.active && Object.values(state.participants).filter(p => p.active).length >= this.limits.participants) throw new PlanningError(`This session supports up to ${this.limits.participants} participants.`);
        if (existing?.active) { await tx.enqueue(response('You have already joined this session.')); return; }
        state.participants[actor.userId] = existing ? { ...existing, active: true, name: actor.name } : {
          userId: actor.userId, name: actor.name, active: true, profile: { version: 0, facts: {} }, silenceAsked: false, cursor: state.nextOrdinal };
      } else {
        if (existing) { existing.active = false; if(!existing.voice)existing.cursor = state.nextOrdinal; }
        state.clarifications = state.clarifications.filter(q => q.userId !== actor.userId);
      }
      this.cancelPlan(room);state.version++; delete state.currentRequest;
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
      if (!person) throw new PlanningError('Join planning or voice first to view your stored profile.');
      const own = structuredClone(state); own.participants = { [person.userId]: person };
      await tx.enqueue(response(summary(own,true),[actor.userId]),true);
    });
  }
  async resetProfile(room: Room, eventId: string, actor: Actor): Promise<void> {
    await this.store.transact(room,eventId,async tx => {
      const state = requireSession(tx.state), person = state.participants[actor.userId];
      if (!person) throw new PlanningError('Join planning or voice first.');
      person.profile = { version: person.profile.version + 1, facts: {} };
      person.cursor = state.nextOrdinal; person.silenceAsked = false;
      state.messages = state.messages.filter(m => m.authorId !== actor.userId);
      state.clarifications = state.clarifications.filter(q => q.userId !== actor.userId);
      this.cancelPlan(room);state.version++; delete state.currentRequest;
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
      this.cancelPlan(room);await this.store.eraseResponses(tx,state.id); tx.state = null;
      await tx.enqueue(response('Session reset. Use /plan start to begin a new session.'));
    });
    await this.memory.clear(room);
  }
  async ask(room: Room, eventId: string, actor: Actor, question: string, replyTo?:string, contextReplyTo?:string): Promise<void> {
    if(isGroupRequest(question)){await this.message({...room,...actor,id:eventId,content:question,botMention:true});return;}
    const claimed = await this.store.transact(room,eventId,async tx => ({ term:tx.state?.term }));
    if (claimed.duplicate) return;
    const prior=await this.memory.begin(room,actor.userId,contextReplyTo);
    const context:ResearchContext={turns:prior.turns};
    const text = await this.answerCourse(question,claimed.value?.term,context);
    await this.memory.finish(room,actor.userId,prior.version,prior.turns,{requestId:eventId,question:question.slice(0,2000),answer:text.slice(0,4000),
      tasks:context.result?.tasks??[],instructors:context.result?.instructors??[],sources:context.result?.sources??[],syllabusCoverage:context.result?.syllabusCoverage});
    await this.store.transact(room,`answer:${eventId}`,async tx => {
      await tx.enqueue({...response(text,[actor.userId]),requestId:eventId,replyTo});
    });
  }
  private answerCourse(question:string,term?:string,context?:ResearchContext):Promise<string> {
    return this.research ? this.research.answer(question,term,context)
      : Promise.resolve('Course research is not connected in this test environment.');
  }
  /** Voice tools share research memory and delivery, with server-bound actor/session context. */
  async voiceQuestion(room:Room,sessionId:string,actor:Actor,question:string,signal:AbortSignal):Promise<string>{
    const state=await this.store.read(room);
    if(state?.id!==sessionId||!state.participants[actor.userId])throw new PlanningError('Voice planning membership expired.');
    const profileVersion=state.participants[actor.userId]!.profile.version;
    signal.throwIfAborted();
    const requestId=`voice:${randomUUID()}`,prior=await this.memory.begin(room,actor.userId);
    const context:ResearchContext={turns:prior.turns,signal};
    const answer=await this.answerCourse(question,state.term||undefined,context);
    signal.throwIfAborted();
    const current=await this.store.read(room);
    if(current?.id!==sessionId||!current.participants[actor.userId]||current.participants[actor.userId]!.profile.version!==profileVersion)throw new PlanningError('Voice planning context changed.');
    await this.memory.finish(room,actor.userId,prior.version,prior.turns,{requestId,question:question.slice(0,2000),answer:answer.slice(0,4000),
      tasks:context.result?.tasks??[],instructors:context.result?.instructors??[],sources:context.result?.sources??[],syllabusCoverage:context.result?.syllabusCoverage});
    await this.store.transact(room,`answer:${requestId}`,async tx=>{
      signal.throwIfAborted();
      if(tx.state?.id!==sessionId||!tx.state.participants[actor.userId]||tx.state.participants[actor.userId]!.profile.version!==profileVersion)throw new PlanningError('Voice planning context changed.');
      await tx.enqueue({...response(answer,[actor.userId]),requestId});
    });
    return answer;
  }
  async voiceIntake(room:Room,sessionId:string,actor:Actor,sourceId:string,text:string,signal?:AbortSignal):Promise<void>{
    await this.store.transact(room,sourceId,async tx=>{
      signal?.throwIfAborted();
      const state=tx.state;
      if(state?.id!==sessionId||!state.participants[actor.userId])return;
      const content=text.trim().slice(0,4000);
      if(!content)return;
      // Speech is pending evidence, not an immediate change to validated preferences.
      const ignored=isCourseQuestion(content)||/^(?:(?:hey|hi|okay|ok)\s*[,!]?\s*)?ray[\s,:]+(?:what|who|how|why|which|tell|recommend|find|summarize)\b/i.test(content);
      state.messages.push({id:sourceId,authorId:actor.userId,content,ordinal:++state.nextOrdinal,ignored});
      while(state.messages.length>this.limits.messages||state.messages.reduce((n,m)=>n+m.content.length,0)>this.limits.characters){state.messages.shift();state.truncated=true;}
    });
  }
  private async voiceRefresh(room:Room,sessionId:string,actor:Actor,signal:AbortSignal,all=false):Promise<PlanningSession>{
    const snapshot=await this.store.read(room);
    if(snapshot?.id!==sessionId||!snapshot.participants[actor.userId])throw new PlanningError('Voice planning membership expired.');
    const patches:{userId:string;patch:Patch;cursor:number}[]=[];
    for(const person of Object.values(snapshot.participants).filter(p=>(p.active||p.voice||p.userId===actor.userId)&&(all||p.userId===actor.userId))){
      signal.throwIfAborted();
      const messages=snapshot.messages.filter(m=>m.authorId===person.userId&&m.ordinal>person.cursor&&!m.ignored);
      if(!messages.length)continue;
      const input={userId:person.userId,profile:person.profile,messages};
      const patch=await this.language.extract(input);validatePatch(patch,input);
      patches.push({userId:person.userId,patch,cursor:Math.max(...messages.map(m=>m.ordinal))});
    }
    signal.throwIfAborted();
    const applied=await this.store.transact(room,`voice-refresh:${randomUUID()}`,async tx=>{
      signal.throwIfAborted();const state=tx.state;
      if(state?.id!==sessionId||state.version!==snapshot.version||state.nextOrdinal!==snapshot.nextOrdinal||!state.participants[actor.userId])throw new PlanningError('Preferences changed while reading notes. Ask Ray again.');
      let changed=false;
      for(const item of patches){
        const person=state.participants[item.userId]!;
        for(const fact of item.patch.facts){
          const previous=person.profile.facts[fact.field];
          if(JSON.stringify({strength:previous?.strength,values:previous?.values})!==JSON.stringify({strength:fact.strength,values:fact.values}))changed=true;
          const sources=[...new Map([...(previous?.sources??[]),...fact.sources].map(source=>[JSON.stringify(source),source])).values()].slice(-12);
          person.profile.facts[fact.field]={...fact,sources};
        }
        if(item.patch.facts.length)person.profile.version++;
        person.cursor=item.cursor;
      }
      if(changed){this.cancelPlan(room);state.version++;delete state.currentRequest;}
      return structuredClone(state);
    });
    return applied.value!;
  }
  async voiceNotes(room:Room,sessionId:string,actor:Actor,signal:AbortSignal):Promise<unknown>{
    const state=await this.voiceRefresh(room,sessionId,actor,signal);
    const person=state.participants[actor.userId]!;
    return {name:person.name,semester:(state.term?semesterName(state.term):'semester not selected'),facts:Object.values(person.profile.facts).filter((f):f is Fact=>Boolean(f)).map(f=>({field:f.field,strength:f.strength,values:f.values})),
      instruction:'Read only this member’s saved needs. Unknown fields stay unknown. Do not imply a recommendation was accepted.'};
  }
  async voiceRecommend(room:Room,sessionId:string,actor:Actor,signal:AbortSignal):Promise<unknown>{
    const enrollment=await this.store.read(room);
    if(enrollment?.id!==sessionId||!enrollment.participants[actor.userId])throw new PlanningError('Voice workspace expired.');
    if(!enrollment.term||!enrollment.participants[actor.userId]?.active) return {planningRequired:true,instruction:enrollment.term?'Invite the speaker to click Join planning in this text channel before requesting group recommendations. Basic questions and voice notes remain available.':'Invite the speaker to start planning with /plan start and choose a semester, then click Join planning in this text channel. Basic questions and voice notes remain available.'};
    if(!this.groupPlanner)throw new PlanningError('Group planning is unavailable.');
    const snapshot=await this.voiceRefresh(room,sessionId,actor,signal,true);
    const requestId=`voice-plan:${randomUUID()}`;
    const result:Recommendation=await this.groupPlanner.recommend(snapshot,'Find shared classes for our group that we can take together.',signal);
    signal.throwIfAborted();
    await this.store.transact(room,requestId,async tx=>{
      signal.throwIfAborted();const state=tx.state;
      if(state?.id!==sessionId||state.version!==snapshot.version||!state.participants[actor.userId]?.active)throw new PlanningError('Preferences changed. Request a fresh recommendation.');
      state.lastRecommendation={inputVersion:state.version,sectionIds:result.sectionIds,createdAt:new Date().toISOString()};
      const body={...response(result.text,Object.values(state.participants).filter(p=>p.active).map(p=>p.userId)),requestId,
        inlineMentions:result.inlineMentions?.filter(m=>state.participants[m.userId]?.active)};
      await tx.enqueue(body,true);
    });
    return {semester:(snapshot.term?semesterName(snapshot.term):'semester not selected'),members:Object.values(snapshot.participants).filter(p=>p.active).map(p=>({name:p.name,
      assignedSectionIds:result.assignments?.find(a=>a.userId===p.userId)?.sectionIds??[],requested:result.assignments?.find(a=>a.userId===p.userId)?.requested??null})),
      notEnrolled:Object.values(snapshot.participants).filter(p=>p.voice&&!p.active).map(p=>p.name),
      presentation:result.spoken??'Structured spoken recommendation details are unavailable. Refer to the detailed plan posted in text; do not invent courses from section IDs.',
      instruction:'Only enrolled members are included. Invite anyone listed in notEnrolled to Join planning before including them. Address each enrolled member by name, then summarize shared options. Preserve preliminary and missing-data qualifications. This is a proposal, not consensus.'};
  }
  async voiceRecap(room:Room,sessionId:string,actor:Actor,signal:AbortSignal):Promise<unknown>{
    const snapshot=await this.voiceRefresh(room,sessionId,actor,signal,true);
    const members=Object.values(snapshot.participants).filter(p=>p.active||p.voice).map(p=>({name:p.name,
      facts:Object.values(p.profile.facts).filter((f):f is Fact=>Boolean(f)).map(f=>({field:f.field,strength:f.strength,values:f.values}))}));
    const plan=snapshot.lastRecommendation;
    const latestPlan=plan?{sectionIds:plan.sectionIds,current:plan.inputVersion===snapshot.version}:null;
    const lines=members.map(p=>`${clean(p.name)}: ${p.facts.length?p.facts.map(f=>`${f.field.replace(/_/g,' ')} (${f.strength}): ${clean(f.values.join('; '))}`).join('; '):'preferences unknown'}`);
    const text=`**Voice session recap · ${(snapshot.term?semesterName(snapshot.term):'semester not selected')}**\n\n${lines.join('\n\n')}\n\n`
      +(latestPlan?`Latest proposed section IDs: ${latestPlan.sectionIds.join(', ')||'none'}.${latestPlan.current?'':' Preferences changed since that plan; request an update.'}`:'No recommendation has been generated yet.')
      +'\nThis records saved needs and proposals; no group acceptance is implied. Degree/prerequisite eligibility and missing requirements remain unchecked.';
    await this.store.transact(room,`voice-recap:${randomUUID()}`,async tx=>{
      signal.throwIfAborted();
      if(tx.state?.id!==sessionId||tx.state.version!==snapshot.version||!tx.state.participants[actor.userId])throw new PlanningError('Session changed. Request a new recap.');
      await tx.enqueue(response(text),true);
    });
    return {semester:(snapshot.term?semesterName(snapshot.term):'semester not selected'),members,latestPlan,instruction:'Briefly recap saved needs and unresolved unknowns. Do not read section IDs aloud or claim the group accepted a plan. Refer to the detailed proposed plan in text.'};
  }
  async message(event: Incoming): Promise<void> {
    if (event.bot || event.webhook) return;
    if (event.botMention || event.replyTo) {
      const session = await this.store.read(event);
      const direct = session?.clarifications.some(q => q.state === 'pending' && q.userId === event.userId && q.messageIds.includes(event.replyTo ?? ''));
      const researchReply=event.replyTo?await this.memory.referenced(event,event.replyTo):null;
      if (!isGroupRequest(event.content) && !direct && (researchReply || (event.botMention && (isCourseQuestion(event.content) || !session)))) {
        await this.ask(event,event.id,event,event.content,event.id,event.replyTo); return;
      }
    }
    const claimed = await this.store.transact(event,event.id,async tx => {
      const state = tx.state, participant = state?.participants[event.userId];
      const pending = state?.clarifications.find(q => q.state === 'pending' && q.userId === event.userId && q.messageIds.includes(event.replyTo ?? ''));
      if (!participant?.active && !event.botMention) return;
      if (participant?.active && state) {
        this.cancelPlan(event);
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
        intent = work.pendingId ? 'profile_update' : event.planCommand?'group_planning':await this.language.classify(event.content);
        if(!work.pendingId&&isGroupRequest(event.content))intent='group_planning';
        return { status: 'classified' };
      })
      .addNode('extract',async () => {
        if (intent === 'course_question' || !work.participant) return { status: 'no_profile_update' };
        const people = Object.values(work.snapshot.participants).filter(p => p.active && (this.groupPlanner || intent !== 'profile_update' || p.userId === event.userId));
        // Sequential two-person batches bound model concurrency; no DB lock during model calls.
        for (let offset=0; offset<people.length; offset+=2) {
          await Promise.all(people.slice(offset,offset+2).map(async person => {
            const messages = work.snapshot.messages.filter(m => m.authorId === person.userId && m.ordinal > person.cursor && !m.ignored);
            if (!messages.length) return;
            const input = { userId: person.userId, profile: person.profile, messages };
            try {
              const patch = await this.language.extract(input); validatePatch(patch,input);
              patches.push({ userId: person.userId, patch, cursor: Math.max(...messages.map(m => m.ordinal)) });
            } catch(error) {
              failed.push(person.userId);
              console.error(JSON.stringify({event:'preference_extraction_failed',reason:error instanceof Error&&error.message==='Preference source does not belong to this author.'?'source_validation':error instanceof Error&&error.message==='Conflicting preference strengths.'?'conflicting_strengths':'invalid_or_unavailable_output'}));
            }
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
    const prepared=await this.store.transact(event,`finish:${work.requestId}`,async tx => {
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
      if (!work.participant) { await tx.enqueue(response('Join planning before requesting group recommendations. You can still use /ask for individual course questions.',[event.userId])); return; }
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
      const shouldRecommend=Boolean(this.groupPlanner)&&(intent==='group_planning'||Boolean(state.lastRecommendation));
      if(!shouldRecommend)attachQuestions(state,body,Boolean(this.groupPlanner),failed);
      if(shouldRecommend){state.currentRequest=work.requestId;return {snapshot:structuredClone(state),body};}
      await tx.enqueue(body,true);
    });
    if(prepared.value&&this.groupPlanner){
      const {snapshot,body}=prepared.value;
      const controller=new AbortController();this.cancelPlan(event);this.activePlans.set(roomId(event),controller);
      let recommendation;
      try{recommendation=await this.groupPlanner.recommend(snapshot,event.content,controller.signal);}
      catch{recommendation={text:'I couldn’t complete group research. Your profiles are saved; use /plan recommend to retry.',sectionIds:[]};}
      finally{if(this.activePlans.get(roomId(event))===controller)this.activePlans.delete(roomId(event));}
      await this.store.transact(event,`recommend:${work.requestId}`,async tx=>{
        const state=tx.state;
        if(!state||state.id!==snapshot.id)return;
        if(state.version!==snapshot.version||state.currentRequest!==work.requestId){
          await tx.enqueue({...response('Preferences or membership changed while I was planning. Use /plan recommend for an updated result.',[event.userId]),requestId:event.id,replyTo:event.id});return;
        }
        delete state.currentRequest;
        state.lastRecommendation={inputVersion:snapshot.version,sectionIds:recommendation.sectionIds,createdAt:new Date().toISOString()};
        body.text=recommendation.text;
        body.inlineMentions=recommendation.inlineMentions?.filter(m=>state.participants[m.userId]?.active&&/^\[\[ray-member:\d+\]\]$/.test(m.marker));
        body.mentions=[...new Set([...body.mentions,...(body.inlineMentions??[]).map(m=>m.userId)])];
        if(failed.length)body.text+=`\nI couldn’t process the latest preferences for ${failed.map(id=>clean(state.participants[id]?.name??id)).join(', ')}. Their messages are retained for retry; these results do not fully account for those updates. Use /plan recommend to retry; no need to repeat the preferences.`;
        attachQuestions(state,body,true,failed);
        body.requestId=event.id;body.replyTo=event.id;
        await tx.enqueue(body,true);
      });
    }
  }
  async recommend(room:Room,eventId:string,actor:Actor):Promise<void>{
    await this.message({...room,...actor,id:eventId,content:'Find shared classes for our group that we can take together.',botMention:true,planCommand:true});
  }
}
