/** Opt-in live model/API check. Optional real intake uses isolated test storage; never posts to Discord. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {loadConfig,repoRoot,safeFailure} from '../src/config/index.js';
import {preferenceModel} from '../src/model/preferences.js';
import type {PlanningSession} from '../src/domain/planning.js';
import {testDatabase,harness,baseScenario,cleanup,type Fixture} from './replay-support.js';
import {PlanningApplication} from '../src/application/planning.js';
import {ResearchScheduler} from '../src/research/scheduler.js';
import {ResearchSources} from '../src/research/sources.js';
import {APIClient} from '../src/integrations/api.js';
import {PlanningCatalogClient} from '../src/planning/catalog.js';
import {ModelPlanningProjection} from '../src/planning/projector.js';
import {ModelSoftFit} from '../src/planning/soft-fit.js';
import {PlanningResearchClient} from '../src/planning/research.js';
import type {Recommendation,Section} from '../src/planning/types.js';
import {sectionsOverlap} from '../src/planning/matcher.js';
import {GroupPlanningEngine} from '../src/planning/engine.js';

let pool:Awaited<ReturnType<typeof testDatabase>>|undefined,namespace:string|undefined;
try{
  const config=loadConfig(),fixture:Fixture=JSON.parse(await readFile(join(repoRoot,'bot/test-data/conversations/recommendation-feedback.json'),'utf8'));
  const session:PlanningSession={id:'test:recommendation',guildId:'test:guild',channelId:'test:channel',creatorId:fixture.actors[0]!.userId,term:'2271',version:1,participants:{},messages:[],nextOrdinal:0,truncated:false,clarifications:[]};
  let modelCalls=0;const request:typeof fetch=(input,init)=>{modelCalls++;return fetch(input,init);};
  const language=preferenceModel(config,request);
  const intake=process.env.RAY_RECOMMENDATION_INTAKE==='true';
  if(!intake)for(const actor of fixture.actors){
    const messages=fixture.messages.filter(m=>m.userId===actor.userId).map((m,i)=>({id:m.id,authorId:actor.userId,content:m.content,ordinal:i+1}));
    const patch=await language.extract({userId:actor.userId,profile:{version:0,facts:{}},messages});
    session.participants[actor.userId]={...actor,active:true,cursor:0,silenceAsked:false,profile:{version:1,facts:Object.fromEntries(patch.facts.map(f=>[f.field,f]))}};
  }
  const scheduler=new ResearchScheduler(),asu=new APIClient(config.ASU_API_BASE_URL,25000),rmp=new APIClient(config.RMP_API_BASE_URL,25000);
  const sources=new ResearchSources(asu,rmp,scheduler),catalogClient=new PlanningCatalogClient(asu,scheduler),sections=new Map<string,Section>();
  const catalog={async search(...args:Parameters<PlanningCatalogClient['search']>){const result=await catalogClient.search(...args);for(const row of result.results)sections.set(row.class_nbr,row);return result;}};
  const planner=new GroupPlanningEngine(new ModelPlanningProjection(config,scheduler,request),catalog,new PlanningResearchClient(config,sources),
    {candidates:12,shortlist:3,timeoutMs:120000,sourceCalls:32},new ModelSoftFit(config,scheduler,request));
  const start=Date.now();let result:Recommendation;
  if(intake){
    pool=await testDatabase();const h=harness(pool,language);namespace=h.namespace;
    await baseScenario(h,fixture);
    // Ordinary messages must stay quiet and defer extraction until the command.
    assert.equal(modelCalls,0);
    let captured:Recommendation|undefined;
    const app=new PlanningApplication(h.store,language,undefined,undefined,{async recommend(snapshot,question,signal){
      Object.assign(session,snapshot);captured=await planner.recommend(snapshot,question,signal);return captured;
    }});
    await app.recommend(h.room,'test:live-recommendation',fixture.actors[0]!);await h.drain();
    assert.ok(captured,'The real intake must reach the recommendation engine');result=captured;
    assert.ok(h.delivered.some(d=>d.text.includes('Overall recommendation')),'Recommendation must pass the application delivery path');
  }else result=await planner.recommend(session,'Suggest schedules for everyone and maximize classes we can take together.',AbortSignal.timeout(120000));
  assert.equal(session.participants[fixture.actors[0]!.userId]!.profile.facts.course_count!.values[0],'2');
  assert.equal(session.participants[fixture.actors[1]!.userId]!.profile.facts.availability!.strength,'hard');
  assert.equal(result.inlineMentions!.length,2);assert.match(result.text,/Overall recommendation/);assert.doesNotMatch(result.text,/Research ·|alternative Tue/);
  assert.deepEqual(result.assignments!.map(a=>a.sectionIds.length),[2,1],'Live demo must actually fill both students’ requested counts');
  assert.match(result.text,/Why:/);assert.match(result.text,/Your preferences:/);
  const minutes=(s:string)=>{const [h,m]=s.split(':').map(Number);return h!*60+m!;};
  for(const assignment of result.assignments??[]){
    const rows=assignment.sectionIds.map(id=>sections.get(id)!);assert.ok(rows.every(Boolean));
    assert.equal(new Set(rows.map(row=>`${row.subject} ${row.catalog_nbr}`)).size,rows.length);
    assert.ok(rows.every(row=>row.term==='2271'&&row.subject==='CSE'&&/^5\d\d$/.test(row.catalog_nbr)));
    for(const row of rows)for(const meeting of row.meeting_intervals){
      assert.equal(meeting.status,'scheduled');assert.ok(meeting.start&&meeting.end);
      if(assignment.userId===fixture.actors[1]!.userId)assert.ok(minutes(meeting.end!)<=17*60);
      else for(const [day,end]of [['MON',12],['TUE',16],['WED',11]] as const)
        if(meeting.days.includes(day))assert.ok(minutes(meeting.end!)<=9*60||minutes(meeting.start!)>=end*60,`${day} work overlap`);
    }
    for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++)assert.equal(sectionsOverlap(rows[i]!,rows[j]!),false);
  }
  const text=result.text.replace(/\[\[ray-member:(\d+)\]\]/g,(_m,i)=>'@'+fixture.actors[Number(i)]!.name)
    .replace(/\]\((https?:\/\/[^)]*)\)/g,(_match,url:string)=>new URL(url).hostname.endsWith('.amazonaws.com')?'](signed-document-link-redacted)':`](${url})`);
  const output=process.env.RAY_RECOMMENDATION_PREVIEW;
  if(output)await writeFile(output,`Simulated student conversation; live model and catalog/review/syllabus evidence.\nChecked ${new Date().toISOString()}; intake: ${intake?'application with isolated test database':'direct extraction'}; no Discord posts.\n\n`+text+'\n');
  console.log(text);
  console.log(JSON.stringify({check:'recommendation-feedback',intake,participants:2,modelCalls,elapsedMs:Date.now()-start,sections:result.sectionIds,discordPosts:0,previewWritten:Boolean(output)}));
}catch(error){safeFailure('recommendation-feedback',error);}
finally{if(pool){try{if(namespace)await cleanup(pool,namespace);}finally{await pool.end();}}}
