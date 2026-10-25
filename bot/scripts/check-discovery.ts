/** Bounded live-model regression of broad course discovery; synthetic IDs, no Discord or database writes. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {loadConfig,repoRoot,safeFailure} from '../src/config/index.js';
import {preferenceModel} from '../src/model/preferences.js';
import type {PlanningSession} from '../src/domain/planning.js';
import {ModelPlanningProjection} from '../src/planning/projector.js';
import {ResearchScheduler} from '../src/research/scheduler.js';
import type {Fixture} from './replay-support.js';

let stage='setup';
try{
  let modelCalls=0;
  const request:typeof fetch=(input,init)=>{modelCalls++;return fetch(input,init);};
  const config=loadConfig(),language=preferenceModel(config,request);
  const data:Fixture=JSON.parse(await readFile(join(repoRoot,'bot/test-data/conversations/broad-course-family.json'),'utf8'));
  const session:PlanningSession={id:'test:discovery',guildId:'test:guild',channelId:'test:channel',creatorId:data.actors[0]!.userId,
    term:'2271',version:1,participants:{},messages:[],nextOrdinal:0,truncated:false,clarifications:[]};
  for(const actor of data.actors){
    const messages=data.messages.filter(m=>m.userId===actor.userId).map((m,i)=>({id:m.id,authorId:m.userId,content:m.content,ordinal:i+1}));
    stage=`extract:${actor.userId}`;
    const patch=await language.extract({userId:actor.userId,profile:{version:0,facts:{}},messages});
    session.participants[actor.userId]={...actor,active:true,cursor:0,silenceAsked:false,profile:{version:1,facts:Object.fromEntries(patch.facts.map(f=>[f.field,f]))}};
  }
  const a=session.participants['test:ann']!.profile.facts,b=session.participants['test:bhav']!.profile.facts;
  assert.match(a.course_count?.values.join(' ')??'',/2|two/i);assert.match(b.course_count?.values.join(' ')??'',/1|one/i);
  assert.ok(Object.values(a).some(f=>f?.strength==='hard'&&/Monday|09:00|9am/i.test(f.values.join(' '))));
  stage='project';
  const projection=await new ModelPlanningProjection(config,new ResearchScheduler(),request).project(session,'Find shared classes using our preferences.',AbortSignal.timeout(45000));
  assert.equal(projection.participants.length,2);assert.ok(projection.queries.some(q=>q.subject==='CSE'&&q.catalog==='5'));
  const constraints=projection.participants.find(p=>p.userId==='test:ann')!.constraints;
  for(const [day,start,end]of [['MON','09:00','12:00'],['TUE','09:00','16:00'],['WED','09:00','11:00']]){
    assert.ok(constraints.some(c=>session.participants['test:ann']!.profile.facts[c.factKey]?.strength==='hard'&&c.kind==='unavailable'&&c.windows.some(w=>w.days.includes(day as 'MON')&&w.start===start&&w.end===end)),`Missing ${day} work exclusion`);
  }
  assert.ok(!constraints.some(c=>session.participants['test:ann']!.profile.facts[c.factKey]?.strength==='hard'&&c.windows.some(w=>w.days.includes('FRI'))),'Friday preference became a hard exclusion');
  console.log(JSON.stringify({check:'broad-course-discovery',status:'passed',participants:2,counts:'2 and 1',workWindows:3,courseFamily:'CSE 500–599',modelCalls,discordPosts:0}));
}catch(error){console.error(JSON.stringify({stage,reason:error instanceof Error&&/^(Preference source|Conflicting preference|Unknown\/duplicate|Projection references|Duplicate preference|Profile fact)/.test(error.message)?error.message:error instanceof assert.AssertionError?error.message:'See safe failure category'}));safeFailure('broad-course-discovery',error);}
