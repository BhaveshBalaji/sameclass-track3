import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type pg from 'pg';
import {repoRoot} from '../src/config/index.js';
import {validatePatch,type Fact,type PlanningSession,type LanguageService} from '../src/domain/planning.js';
import {matchCandidates} from '../src/planning/matcher.js';
import {GroupPlanningEngine} from '../src/planning/engine.js';
import type {Constraint,Projection,Section,GroupPlanner} from '../src/planning/types.js';
import {PlanningApplication} from '../src/application/planning.js';
import {fixture,fixtureLanguage,testDatabase,harness,baseScenario,cleanup,type Fixture} from '../scripts/replay-support.js';

let pool:pg.Pool,data:Fixture,base:PlanningSession,projection:Projection,template:Section;
const namespaces:string[]=[];
before(async()=>{
  pool=await testDatabase();data=await fixture();const h=harness(pool,fixtureLanguage().language);namespaces.push(h.namespace);await baseScenario(h,data);base=(await h.store.read(h.room))!;
  template=JSON.parse(await readFile(join(repoRoot,'class_search_api/example_response.json'),'utf8')).results[0];
  projection={queries:[{subject:'CSE',catalog:'512',keyword:''}],participants:Object.values(base.participants).map(p=>({userId:p.userId,constraints:Object.values(p.profile.facts).map(f=>constraint(f!,p.userId))}))};
});
after(async()=>{for(const n of namespaces)await cleanup(pool,n);await pool.end();});
function constraint(f:Fact,id:string):Constraint{
  const c:Constraint={factKey:f.field,kind:'other',understood:true,values:f.values,min:null,max:null,windows:[]};
  if(f.field==='approved_courses')c.kind='allowed_courses';
  if(f.field==='credits'){c.kind='course_credits';c.min=3;c.max=3;}
  if(f.field==='campus'){c.kind='campus';c.values=['TEMPE'];}
  if(f.field==='unavailability'){
    c.kind='unavailable';c.windows=[{days:id==='test:maya'?['MON','TUE','WED','THU','FRI']:id==='test:leo'?['TUE','THU']:['MON','WED'],
      start:id==='test:maya'?'00:00':id==='test:leo'?'14:00':'16:00',end:id==='test:maya'?'12:00':id==='test:leo'?'18:00':'24:00',startDate:null,endDate:null,timezone:'America/Phoenix'}];
  }
  return c;
}
function section(catalog='512',number='90001',days=['MON','WED'],start='13:00',end='14:15'):Section{
  return {...template,subject:'CSE',catalog_nbr:catalog,class_nbr:number,title:'Synthetic class',campus:'TEMPE',component:'LEC',units_min:'3',units_max:'3',
    linked_components:{status:'verified',required_class_numbers:[],source_url:template.class_url},
    meeting_intervals:[{days,start,end,start_date:'2027-01-11',end_date:'2027-04-30',status:'scheduled'}]};
}
test('shared choice covers three known students without treating silent Dev as flexible',()=>{
  const [candidate]=matchCandidates(base,projection,[section()]);
  assert.equal(candidate!.shared,true);assert.equal(candidate!.covered,3);assert.equal(candidate!.fits.find(f=>f.userId==='test:dev')!.status,'unknown');
  const corrected=structuredClone(projection);corrected.participants.find(p=>p.userId==='test:maya')!.constraints.find(c=>c.kind==='unavailable')!.windows.push({days:['MON'],start:'12:00',end:'15:00',startDate:null,endDate:null,timezone:'America/Phoenix'});
  assert.equal(matchCandidates(base,corrected,[section()])[0]!.shared,false);
});
test('linked lab conflict, unknown meeting intervals and missing linkage never become verified fits',()=>{
  const lecture=section(),lab={...section('512','90002',['TUE'],'10:00','11:00'),component:'LAB'};
  lecture.linked_components!.required_class_numbers=['90002'];
  let candidate=matchCandidates(base,projection,[lecture,lab])[0]!;
  assert.equal(candidate.fits.find(f=>f.userId==='test:maya')!.status,'conflict');assert.equal(candidate.shared,false);
  const unknown=section();delete unknown.linked_components;
  assert.equal(matchCandidates(base,projection,[unknown])[0]!.bundleVerified,false);
  const missingTime=section();missingTime.meeting_intervals.push({days:[],start:null,end:null,start_date:null,end_date:null,status:'unknown'});
  candidate=matchCandidates(base,projection,[missingTime])[0]!;assert.equal(candidate.covered,0);
});
test('no shared match preserves conflicts and produces useful individual alternatives',async()=>{
  const sections=[section('511','90003',['MON'],'09:00','10:00'),section('575','90004',['THU'],'19:00','20:00')];
  const engine=new GroupPlanningEngine({async project(){return projection;}},{async search(){return {count:2,total:2,results:sections,pages_fetched:1,complete:true,stop_reason:'exhausted',retrieved_at:'2026-10-25T02:00:00Z'};}},undefined);
  const result=await engine.recommend(base,'Find courses together',AbortSignal.timeout(1000));
  assert.match(result.text,/No common section was selected/);assert.match(result.text,/alternative/);assert.doesNotMatch(result.text,/guaranteed|verified backup/);
});
test('one failed catalog sibling does not erase a successful candidate and custom hard facts stay unchecked',async()=>{
  const custom=structuredClone(base);custom.participants['test:maya']!.profile.facts.accessibility={field:'accessibility',strength:'hard',values:['Step-free classrooms'],sources:[{messageId:'test:m01',quote:'Synthetic source'}]};
  const queries={...projection,queries:[...projection.queries,{subject:'CSE',catalog:'575',keyword:''}]};
  const engine=new GroupPlanningEngine({async project(){return queries;}},{async search(q){if(q.catalog==='575')throw Error('Source failure');return {count:1,total:1,results:[section()],pages_fetched:1,complete:true,stop_reason:'exhausted',retrieved_at:'2026-10-25T02:00:00Z'};}},undefined);
  const result=await engine.recommend(custom,'Find courses together',AbortSignal.timeout(1000));
  assert.match(result.text,/90001/);assert.match(result.text,/lookup failed/);assert.match(result.text,/accessibility has not been checked/);
  validatePatch({facts:[{field:'commute_minutes',strength:'hard',values:['At most 30 minutes'],sources:[{messageId:'m',quote:'At most 30 minutes'}]}]},
    {userId:'u',profile:{version:0,facts:{}},messages:[{id:'m',authorId:'u',content:'At most 30 minutes',ordinal:1}]});
});
test('a correction during research cancels and discards the old result; reset/membership/session isolation remain scoped',async()=>{
  const fake=fixtureLanguage(),h=harness(pool,fake.language);namespaces.push(h.namespace);await baseScenario(h,data);
  let entered!:()=>void,finish!:()=>void;
  const started=new Promise<void>(r=>{entered=r;}),pause=new Promise<void>(r=>{finish=r;});let signal:AbortSignal|undefined;
  const planner:GroupPlanner={async recommend(_s,_q,current){signal=current;entered();await pause;return {text:'OBSOLETE RECOMMENDATION',sectionIds:['old']};}};
  const app=new PlanningApplication(h.store,fake.language,undefined,undefined,planner);
  const pending=app.recommend(h.room,'recommend',data.actors[0]!);await started;
  await app.message({...h.room,...data.actors[0]!,id:'correction',content:'I cannot do Mondays now.',botMention:false});
  assert.equal(signal?.aborted,true);finish();await pending;await h.drain();
  assert.ok(!h.delivered.some(m=>m.text.includes('OBSOLETE RECOMMENDATION')));assert.match(h.delivered.at(-1)!.text,/changed while I was planning/);
  assert.equal((await h.store.read(h.room))!.lastRecommendation,undefined);
  const other={guildId:h.room.guildId,channelId:'test:other'};await app.start(other,'other-start',data.actors[1]!,'Spring 2027');
  await app.membership(h.room,'leave',data.actors[1]!, (await h.store.read(h.room))!.id,false);
  assert.equal((await h.store.read(h.room))!.participants[data.actors[1]!.userId]!.active,false);
  const original=(await h.store.read(h.room))!;await app.requestReset(h.room,'reset',data.actors[0]!);
  const token=(await h.store.read(h.room))!.resetConfirmation!.token;await app.confirmReset(h.room,'confirm',data.actors[0]!,original.id,token);
  assert.equal(await h.store.read(h.room),null);assert.ok(await h.store.read(other));
});
test('flexible facts and later corrections remain owned by the author',async()=>{
  const h=harness(pool,fixtureLanguage().language);namespaces.push(h.namespace);await baseScenario(h,data);
  const before=(await h.store.read(h.room))!.participants['test:leo']!.profile;
  const language:LanguageService={async classify(){return 'profile_update';},async extract(input){
    const m=input.messages.find(m=>m.id==='custom-1'||m.id==='custom-2');
    return {facts:m?[{field:'commute_minutes',strength:'hard',values:[m.id==='custom-1'?'30':'15'],sources:[{messageId:m.id,quote:m.content}]}]:[]};
  }};
  const app=new PlanningApplication(h.store,language);
  await app.message({...h.room,...data.actors[0]!,id:'custom-1',content:'My commute limit is 30 minutes.',botMention:true});
  await app.message({...h.room,...data.actors[0]!,id:'custom-2',content:'Correction, my commute limit is 15 minutes.',botMention:true});
  const state=(await h.store.read(h.room))!;
  assert.deepEqual(state.participants['test:maya']!.profile.facts.commute_minutes!.values,['15']);
  assert.deepEqual(state.participants['test:leo']!.profile,before);
  assert.equal(state.participants['test:maya']!.profile.facts.commute_minutes!.sources.length,2);
});
test('leave and confirmed reset during a pending run cannot resurrect its result',async()=>{
  for(const action of ['leave','reset']){
    const fake=fixtureLanguage(),h=harness(pool,fake.language);namespaces.push(h.namespace);await baseScenario(h,data);
    let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>{entered=r;}),pause=new Promise<void>(r=>{release=r;});
    let signal:AbortSignal|undefined;
    const app=new PlanningApplication(h.store,fake.language,undefined,undefined,{async recommend(_s,_q,current){signal=current;entered();await pause;return {text:'OBSOLETE',sectionIds:['old']};}});
    const run=app.recommend(h.room,'pending',data.actors[0]!);await started;
    const session=(await h.store.read(h.room))!;
    if(action==='leave')await app.membership(h.room,'leave-now',data.actors[1]!,session.id,false);
    else{await app.requestReset(h.room,'reset-now',data.actors[0]!);await app.confirmReset(h.room,'confirm-now',data.actors[0]!,session.id,(await h.store.read(h.room))!.resetConfirmation!.token);}
    assert.equal(signal!.aborted,true);release();await run;await h.drain();
    assert.ok(!h.delivered.some(m=>m.text.includes('OBSOLETE')));
    if(action==='reset')assert.equal(await h.store.read(h.room),null);
  }
});
test('a silent student’s direct clarification refreshes an existing plan without another group mention',async()=>{
  const fake=fixtureLanguage(),h=harness(pool,fake.language);namespaces.push(h.namespace);await baseScenario(h,data);
  const counts:number[]=[];
  const app=new PlanningApplication(h.store,fake.language,undefined,undefined,{async recommend(session){counts.push(Object.keys(session.participants['test:dev']!.profile.facts).length);return {text:'UPDATED PLAN',sectionIds:['new']};}});
  await app.recommend(h.room,'first-plan',data.actors[0]!);await h.drain();
  const state=(await h.store.read(h.room))!,pending=state.clarifications.find(q=>q.userId==='test:dev'&&q.state==='pending')!;
  await app.message({...h.room,...data.continuations[0]!,botMention:false,replyTo:pending.messageIds[0]});await h.drain();
  assert.deepEqual(counts,[0,2]);
  const final=(await h.store.read(h.room))!;
  assert.equal(final.clarifications.filter(q=>q.userId==='test:dev'&&q.field==='participation').length,1);
  assert.ok(final.lastRecommendation);
});
test('online campus preferences use the online catalog and match its campus alias',async()=>{
  const online=structuredClone(base),compiled=structuredClone(projection);
  for(const p of Object.values(online.participants))if(p.profile.facts.campus)p.profile.facts.campus.values=['ASU Online'];
  for(const p of compiled.participants)for(const c of p.constraints)if(c.kind==='campus')c.values=['ONLINE'];
  const requested:string[]=[];
  const engine=new GroupPlanningEngine({async project(){return compiled;}},{async search(q){requested.push(q.delivery??'');return {count:1,total:1,results:[{...section(),campus:'ASUONLINE'}],complete:true,stop_reason:'exhausted',pages_fetched:1,retrieved_at:'2026-10-25T02:00:00Z'};}},undefined);
  const result=await engine.recommend(online,'Find an online class together',AbortSignal.timeout(1000));
  assert.deepEqual(requested,['O']);assert.doesNotMatch(result.text,/Campus ASUONLINE does not match/);assert.match(result.text,/Option 1/);
});
