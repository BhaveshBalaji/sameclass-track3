import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import {PlanningApplication} from '../src/application/planning.js';
import {PlanningStore} from '../src/persistence/planning-store.js';
import {testDatabase,cleanup} from '../scripts/replay-support.js';
import type {LanguageService,Patch} from '../src/domain/planning.js';
import type {GroupPlanner} from '../src/planning/types.js';
let pool:pg.Pool;const namespaces:string[]=[];
before(async()=>{pool=await testDatabase();});
after(async()=>{for(const namespace of namespaces)await cleanup(pool,namespace);await pool.end();});
const alice={userId:'voice:alice',name:'Alice'},bob={userId:'voice:bob',name:'Bob'},room={guildId:'voice:guild',channelId:'voice:text'};
const language:LanguageService={classify:async()=> 'profile_update',extract:async input=>{
  const message=input.messages.at(-1)!;
  return {facts:[{field:'unavailability',strength:'hard',values:[message.content],sources:[{messageId:message.id,quote:message.content}]}]};
}};
async function setup(model=language,planner?:GroupPlanner){
  const namespace=`test:voice:${crypto.randomUUID()}`;namespaces.push(namespace);
  const store=new PlanningStore(pool,namespace),app=new PlanningApplication(store,model,undefined,undefined,planner);
  await app.start(room,'start',alice,'Spring 2027');const id=(await store.read(room))!.id;
  for(const actor of [alice,bob])await app.membership(room,'join:'+actor.userId,actor,id,true);
  return {app,store,id};
}
test('voice notes stay pending until read-back and corrections remain author-owned in the shared text profile',async()=>{
  const {app,store,id}=await setup();const version=(await store.read(room))!.version;
  await app.voiceIntake(room,id,alice,'a1','I work Tuesdays.');await app.voiceIntake(room,id,bob,'b1','I work Fridays.');
  assert.equal((await store.read(room))!.version,version);
  assert.equal(Object.keys((await store.read(room))!.participants[alice.userId]!.profile.facts).length,0);
  await app.voiceNotes(room,id,alice,new AbortController().signal);
  let state=(await store.read(room))!;
  assert.deepEqual(state.participants[alice.userId]!.profile.facts.unavailability!.values,['I work Tuesdays.']);
  assert.equal(Object.keys(state.participants[bob.userId]!.profile.facts).length,0);
  await app.voiceIntake(room,id,alice,'a2','Actually, I work Thursdays.');
  await app.voiceNotes(room,id,alice,new AbortController().signal);await app.voiceNotes(room,id,bob,new AbortController().signal);
  state=(await store.read(room))!;
  assert.deepEqual(state.participants[alice.userId]!.profile.facts.unavailability!.values,['Actually, I work Thursdays.']);
  assert.deepEqual(state.participants[bob.userId]!.profile.facts.unavailability!.values,['I work Fridays.']);
  await app.voiceIntake(room,id,alice,'question','Hey Ray, what is CSE 445 about?');
  await app.voiceNotes(room,id,alice,new AbortController().signal);
  assert.deepEqual((await store.read(room))!.participants[alice.userId]!.profile.facts.unavailability!.values,['Actually, I work Thursdays.']);
});
test('reset during preference extraction cannot resurrect retained voice sources or facts',async()=>{
  let release!:(patch:Patch)=>void,started!:()=>void;const waiting=new Promise<void>(resolve=>{started=resolve;});
  const {app,store,id}=await setup({...language,extract:async()=>{started();return new Promise(resolve=>{release=resolve;});}});
  await app.voiceIntake(room,id,alice,'a1','I work Tuesdays.');
  const pending=app.voiceNotes(room,id,alice,new AbortController().signal);await waiting;
  await app.resetProfile(room,'reset',alice);
  release({facts:[{field:'unavailability',strength:'hard',values:['Tuesdays'],sources:[{messageId:'a1',quote:'I work Tuesdays.'}]}]});
  await assert.rejects(()=>pending,/changed/);
  const state=(await store.read(room))!;assert.equal(state.messages.length,0);assert.deepEqual(state.participants[alice.userId]!.profile.facts,{});
});
test('group voice request refreshes both members and publishes the planner assignments through the outbox',async()=>{
  let seen:string[]=[];
  const {app,store,id}=await setup(language,{recommend:async snapshot=>{
    seen=Object.values(snapshot.participants).map(p=>p.profile.facts.unavailability!.values[0]!);
    return {text:'Synthetic test recommendation',sectionIds:['123'],assignments:[{userId:alice.userId,requested:1,sectionIds:['123']},{userId:bob.userId,requested:1,sectionIds:[]}],
      spoken:{members:[],shared:[],limitations:['synthetic test']}};
  }});
  await app.voiceIntake(room,id,alice,'a1','I work Tuesdays.');await app.voiceIntake(room,id,bob,'b1','I work Fridays.');
  const result=await app.voiceRecommend(room,id,alice,new AbortController().signal) as {members:{name:string;assignedSectionIds:string[]}[]};
  assert.deepEqual(seen.sort(),['I work Fridays.','I work Tuesdays.']);
  assert.deepEqual(result.members.sort((a,b)=>a.name.localeCompare(b.name)).map(p=>[p.name,p.assignedSectionIds]),[['Alice',['123']],['Bob',[]]]);
  const sent:string[]=[];await store.deliver(room,async(body)=>{sent.push(body.text);return crypto.randomUUID();});
  assert.ok(sent.includes('Synthetic test recommendation'));
});
test('interrupted or superseded voice plan is not queued for text delivery',async()=>{
  let release!:()=>void,started!:()=>void;const waiting=new Promise<void>(resolve=>{started=resolve;});
  const {app,store,id}=await setup(language,{recommend:async()=>{started();await new Promise<void>(resolve=>{release=resolve;});return {text:'stale synthetic plan',sectionIds:[]};}});
  const controller=new AbortController();const pending=app.voiceRecommend(room,id,alice,controller.signal);await waiting;
  controller.abort();release();await assert.rejects(()=>pending);
  const sent:string[]=[];await store.deliver(room,async(body)=>{sent.push(body.text);return crypto.randomUUID();});
  assert.ok(!sent.includes('stale synthetic plan'));
});
test('recap refreshes notes and explicitly preserves unknowns without claiming acceptance',async()=>{
  const {app,store,id}=await setup();
  await app.voiceIntake(room,id,alice,'a1','I work Tuesdays.');
  const result=await app.voiceRecap(room,id,alice,new AbortController().signal) as {members:{name:string;facts:unknown[]}[];latestPlan:unknown};
  assert.equal(result.latestPlan,null);assert.equal(result.members.find(p=>p.name==='Bob')!.facts.length,0);
  const sent:string[]=[];await store.deliver(room,async body=>{sent.push(body.text);return crypto.randomUUID();});
  const recap=sent.find(s=>s.includes('Voice session recap'))!;
  assert.match(recap,/Bob: preferences unknown/);assert.match(recap,/no group acceptance is implied/);
});
