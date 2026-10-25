import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type pg from 'pg';
import {parseConfig,repoRoot} from '../src/config/index.js';
import {mergeFactUpdates,validatePatch,type ExtractionInput,type Fact,type PlanningSession} from '../src/domain/planning.js';
import {preferenceModel} from '../src/model/preferences.js';
import {PlanningApplication} from '../src/application/planning.js';
import {ModelPlanningProjection} from '../src/planning/projector.js';
import {PlanningCatalogClient} from '../src/planning/catalog.js';
import {GroupPlanningEngine} from '../src/planning/engine.js';
import {matchCandidates} from '../src/planning/matcher.js';
import {includeCourseFamilies,courseFamilies} from '../src/planning/course-family.js';
import {explicitCourseRequest} from '../src/model/explicit-course-request.js';
import {APIClient} from '../src/integrations/api.js';
import {ResearchScheduler} from '../src/research/scheduler.js';
import type {Projection,Section} from '../src/planning/types.js';
import {testDatabase,harness,cleanup,type Fixture} from '../scripts/replay-support.js';

const config=parseConfig({OPENROUTER_API_KEY:'test-only'});
const data:Fixture=JSON.parse(await readFile(join(repoRoot,'bot/test-data/conversations/broad-course-family.json'),'utf8'));
const template:Section=JSON.parse(await readFile(join(repoRoot,'class_search_api/example_response.json'),'utf8')).results[0];
const emptySession=():PlanningSession=>({id:'test:plan',guildId:'test:guild',channelId:'test:channel',creatorId:'test:ann',term:'2271',version:1,participants:{},messages:[],nextOrdinal:0,truncated:false,clarifications:[]});
function rawFacts(input:ExtractionInput):Fact[]{
  const fact=(field:string,strength:Fact['strength'],values:string[],index:number):Fact=>({field,strength,values,sources:[{messageId:input.messages[index]!.id,quote:input.messages[index]!.content}]});
  return input.userId==='test:ann'?[fact('course_count','hard',['2 courses'],0),fact('course_family','hard',['CSE 5xx'],0),
    fact('topics','soft',['AI','databases'],2),fact('topics','soft',['lighter workload'],1),
    fact('unavailability','hard',['Monday 09:00-12:00'],3),fact('unavailability','hard',['Tuesday 09:00-16:00','Wednesday 09:00-11:00'],3),
    fact('preferred_times','soft',['morning and noon','Friday free if possible; Thursday if necessary'],5)]:
    [fact('course_count','hard',['1 course'],0),fact('course_family','hard',['CSE 5xx'],0),fact('topics','soft',['AI','easy courses'],0),fact('preferred_times','soft',['before 17:00'],1)];
}
function wire(value:unknown){return Response.json({id:'test',provider:'Relace',model:config.OPENROUTER_MODEL,object:'chat.completion',created:1,
  choices:[{index:0,message:{role:'assistant',content:JSON.stringify(value)},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}});}
const model=preferenceModel(config,async(_input,init)=>{
  const body=JSON.parse(String(init?.body));return wire({facts:rawFacts(JSON.parse(body.messages.at(-1).content))});
});
async function extractedSession(){
  const session=emptySession();
  for(const actor of data.actors){
    const messages=data.messages.filter(m=>m.userId===actor.userId).map((m,i)=>({id:m.id,authorId:m.userId,content:m.content,ordinal:i+1}));
    const patch=await model.extract({userId:actor.userId,profile:{version:0,facts:{}},messages});
    session.participants[actor.userId]={...actor,active:true,cursor:0,silenceAsked:false,profile:{version:1,facts:Object.fromEntries(patch.facts.map(f=>[f.field,f]))}};
  }
  return session;
}
test('duplicate fields retain both students’ full author-owned preferences through the real SDK path',async()=>{
  const session=await extractedSession(),ann=session.participants['test:ann']!,bhav=session.participants['test:bhav']!;
  assert.equal(ann.profile.facts.unavailability!.values.length,3);
  assert.deepEqual(ann.profile.facts.course_count!.values,['2']);assert.deepEqual(bhav.profile.facts.course_count!.values,['1']);
  assert.ok(ann.profile.facts.topics!.values.includes('databases'));assert.equal(bhav.profile.facts.unavailability,undefined);
  const input={userId:'u',profile:{version:0,facts:{}},messages:[{id:'m',authorId:'someone-else',content:'exact quote',ordinal:1}]};
  assert.throws(()=>validatePatch(mergeFactUpdates({facts:[{field:'topics',strength:'soft',values:['AI'],sources:[{messageId:'m',quote:'exact quote'}]}]}),input),/author/);
  assert.throws(()=>mergeFactUpdates({facts:[{field:'topics',strength:'soft',values:['AI'],sources:[{messageId:'m',quote:'AI'}]},
    {field:'topics',strength:'hard',values:['AI'],sources:[{messageId:'m',quote:'AI'}]}]}),/strength/);
});
test('one invalid source gets one repair attempt; invalid evidence never silently passes',async()=>{
  const input:ExtractionInput={userId:'u',profile:{version:0,facts:{}},messages:[{id:'real',authorId:'u',content:'I need CSE 5xx',ordinal:1}]};
  let calls=0;
  const repair=preferenceModel(config,async(_input,init)=>{
    calls++;
    if(calls===2)assert.match(String(init?.body),/Validation feedback/);
    return wire({facts:[{field:'course_family',strength:'hard',values:['CSE 5xx'],sources:[{messageId:calls===1?'invented':'real',quote:'CSE 5xx'}]}]});
  });
  assert.equal((await repair.extract(input)).facts.length,1);assert.equal(calls,2);
  let invalidCalls=0;
  const invalid=preferenceModel(config,async()=>{invalidCalls++;return wire({facts:[{field:'course_family',strength:'hard',values:['CSE 5xx'],sources:[{messageId:'foreign',quote:'CSE 5xx'}]}]});});
  await assert.rejects(invalid.extract(input),/author/);assert.equal(invalidCalls,2);
});
test('literal course counts stay grounded; hypothetical/quoted/other-author requests are not inferred',()=>{
  for(const text of ['What if I need two CSE 5xx courses?','"I need two CSE 5xx courses"','My friend needs two CSE 5xx courses']){
    assert.deepEqual(explicitCourseRequest({userId:'u',profile:{version:0,facts:{}},messages:[{id:'m',authorId:'u',content:text,ordinal:1}]},{facts:[]}).facts,[]);
  }
  assert.deepEqual(courseFamilies(['CSE 500-599']),[{subject:'CSE',prefix:'5'}]);
  assert.deepEqual(courseFamilies(['CSE 500-550','CSE 500-699']),[]);
});
test('CSE 5xx searches an actual prefix and checks each student, even if projection omits a participant',async()=>{
  const session=await extractedSession();
  const projector=new ModelPlanningProjection(config,new ResearchScheduler(),async()=>wire({queries:[],participants:[{userId:'test:bhav',constraints:[]}]}));
  const projection=await projector.project(session,'Find courses for us',AbortSignal.timeout(2000));
  assert.deepEqual(projection.queries,[{subject:'CSE',catalog:'5',keyword:''}]);assert.equal(projection.participants.length,2);
  const ann=projection.participants.find(p=>p.userId==='test:ann')!;
  ann.constraints.push({factKey:'unavailability',kind:'unavailable',understood:true,values:[],min:null,max:null,
    windows:[{days:['MON'],start:'09:00',end:'12:00',startDate:null,endDate:null,timezone:'America/Phoenix'}]});
  const morning={...template,subject:'CSE',catalog_nbr:'575',class_nbr:'90001',meeting_intervals:[{days:['MON'],start:'10:00',end:'11:00',start_date:null,end_date:null,status:'scheduled' as const}]};
  const familyFit=matchCandidates(session,projection,[morning,{...morning,class_nbr:'90002',catalog_nbr:'445'}]);
  assert.ok(familyFit.every(c=>c.fits.length===2));
  assert.equal(familyFit.find(c=>c.section.class_nbr==='90001')!.fits.find(f=>f.userId==='test:ann')!.status,'conflict');
  assert.ok(familyFit.find(c=>c.section.catalog_nbr==='445')!.fits.every(f=>f.conflicts.some(c=>c.includes('course family'))));
  const source=new PlanningCatalogClient(new APIClient('https://asu.test',1000,async input=>{
    assert.equal(new URL(String(input)).searchParams.get('catalog_nbr'),'');
    assert.equal(new URL(String(input)).searchParams.get('level'),'grad');
    return Response.json({count:2,total:2,results:[morning,{...morning,class_nbr:'90003',catalog_nbr:'645'}],complete:true,stop_reason:'exhausted',pages_fetched:1,retrieved_at:'2026-10-25T02:00:00Z'});
  }),new ResearchScheduler());
  assert.equal((await source.search({term:'2271',subject:'CSE',catalog:'5'},AbortSignal.timeout(2000))).count,1);
  assert.equal(includeCourseFamilies(session,projection).participants.length,2);
});
test('topic relevance selects AI for bounded research without claiming it is easy or a verified fit',async()=>{
  const session=await extractedSession(),lookups:string[]=[];
  const sections=[{...template,class_nbr:'90001',catalog_nbr:'510',title:'Foundations of Algorithms'},
    {...template,class_nbr:'90002',catalog_nbr:'571',title:'Artificial Intelligence'}];
  const engine=new GroupPlanningEngine({async project(){return {queries:[],participants:[]};}},
    {async search(){return {count:2,total:2,results:sections,complete:true,stop_reason:'exhausted',pages_fetched:1,retrieved_at:'2026-10-25T02:00:00Z'};}},
    {async answer(question){lookups.push(question);return 'Assessment evidence unavailable.';}},{candidates:1,shortlist:1,timeoutMs:2000});
  const result=await engine.recommend(session,'Find courses for us',AbortSignal.timeout(2000));
  assert.equal(lookups.length,1);assert.match(lookups[0]!,/CSE 571/);assert.match(result.text,/checks incomplete/);assert.doesNotMatch(result.text,/guaranteed easy|verified fit/);
});

let pool:pg.Pool;const namespaces:string[]=[];
before(async()=>{pool=await testDatabase();});
after(async()=>{for(const n of namespaces)await cleanup(pool,n);await pool.end();});
test('conversation replay starts discovery for both students without demanding an approved list or optional intake',async()=>{
  const h=harness(pool,model);namespaces.push(h.namespace);const seen:PlanningSession[]=[];
  const engine=new GroupPlanningEngine({async project(session){seen.push(structuredClone(session));return {queries:[],participants:[]} as Projection;}},
    {async search(q){assert.equal(q.catalog,'5');return {count:1,total:1,results:[{...template,catalog_nbr:'575'}],complete:true,stop_reason:'exhausted',pages_fetched:1,retrieved_at:'2026-10-25T02:00:00Z'};}});
  const app=new PlanningApplication(h.store,model,undefined,undefined,engine);
  await app.start(h.room,'start',data.actors[0]!,data.term);const state=(await h.store.read(h.room))!;
  for(const actor of data.actors)await app.membership(h.room,'join:'+actor.userId,actor,state.id,true);
  for(const message of data.messages)await app.message({...h.room,...message});
  assert.equal(seen.length,0); // Ordinary conversation does not invoke the assistant.
  await app.recommend(h.room,'recommend',data.actors[1]!);await h.drain();
  assert.equal(seen.length,1);assert.equal(seen[0]!.participants['test:ann']!.profile.facts.unavailability!.values.length,3);
  const text=h.delivered.map(m=>m.text).join('\n');assert.match(text,/Student A/);assert.match(text,/Student B/);assert.match(text,/Student A: 2/);
  assert.doesNotMatch(text,/Which courses|approved list for|How many credits|Which campus|Would you like to share/);
  assert.equal((await h.store.read(h.room))!.clarifications.length,0);
  await app.profile(h.room,'profile',data.actors[1]!);await h.drain();
  assert.match(h.delivered.at(-1)!.text,/Your planning profile/);assert.doesNotMatch(h.delivered.at(-1)!.text,/1 joined/);
  assert.equal(Object.keys((await h.store.read(h.room))!.participants).length,2);
});
test('a failed author is not called silent, retains messages and is included after a retry',async()=>{
  let fail=true;
  const language={...model,async extract(input:ExtractionInput){if(fail&&input.userId==='test:ann')throw Error('model unavailable');return model.extract(input);}};
  const h=harness(pool,language);namespaces.push(h.namespace);const snapshots:PlanningSession[]=[];
  const app=new PlanningApplication(h.store,language,undefined,undefined,{async recommend(s){snapshots.push(structuredClone(s));return {text:'Preliminary options',sectionIds:[]};}});
  await app.start(h.room,'start',data.actors[0]!,data.term);const session=(await h.store.read(h.room))!;
  for(const actor of data.actors)await app.membership(h.room,'join:'+actor.userId,actor,session.id,true);
  for(const message of data.messages)await app.message({...h.room,...message});
  await app.recommend(h.room,'first',data.actors[1]!);await h.drain();
  assert.match(h.delivered.at(-1)!.text,/couldn’t process.*Student A/);assert.doesNotMatch(h.delivered.at(-1)!.text,/Would you like to share/);
  const before=(await h.store.read(h.room))!;assert.ok(before.messages.some(m=>m.authorId==='test:ann'));assert.equal(before.participants['test:ann']!.cursor,0);
  fail=false;await app.recommend(h.room,'retry',data.actors[1]!);await h.drain();
  assert.equal(snapshots.length,2);assert.ok(snapshots[1]!.participants['test:ann']!.profile.facts.unavailability);
  assert.ok(snapshots[1]!.participants['test:bhav']!.profile.facts.course_count);
});
