import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseConfig,repoRoot} from '../src/config/index.js';
import {APIClient} from '../src/integrations/api.js';
import {ResearchAgent,researchLinks,type ResearchDiagnostics} from '../src/research/agent.js';
import {ResearchScheduler} from '../src/research/scheduler.js';
import {ResearchSources,normalizeCourseLabel} from '../src/research/sources.js';
import {ResearchMemory} from '../src/persistence/research-context.js';
import {testDatabase,cleanup} from '../scripts/replay-support.js';
import type {ResearchContext,ResearchTask,Evidence} from '../src/research/types.js';

test('screenshot follow-up inherits its replied context and dispatches professor reviews concurrently',async()=>{
  const pool=await testDatabase(),namespace=`test:${randomUUID()}`,room={guildId:'test:guild',channelId:'test:replies'};
  const memory=new ResearchMemory(pool,namespace),config=parseConfig({OPENROUTER_API_KEY:'test-only'}),scheduler=new ResearchScheduler();
  const fixture=JSON.parse(await readFile(join(repoRoot,'class_search_api/example_response.json'),'utf8'));
  const names=['Erik Trickel','Eric Eckert'];
  fixture.results=names.map((name,i)=>({...fixture.results[0],subject:'CSE',catalog_nbr:'240',course:'CSE 240',instructors:[{name}],class_nbr:String(90000+i)}));fixture.count=2;
  let active=0,peak=0;const diagnostics:ResearchDiagnostics[]=[];
  const prof=(name:string)=>({id:Buffer.from(`Teacher-${names.indexOf(name)+1}`).toString('base64'),legacyId:names.indexOf(name)+1,
    firstName:name.split(' ')[0],lastName:name.split(' ')[1],department:'Computer Science',avgRating:4,avgDifficulty:3,numRatings:2,wouldTakeAgainPercent:90});
  const source=new ResearchSources(new APIClient('https://asu.test',1000,async()=>Response.json(fixture)),new APIClient('https://rmp.test',1000,async input=>{
    active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));
    try{
      const url=new URL(String(input));
      if(url.pathname==='/api/professors')return Response.json({professors:[prof(url.searchParams.get('q')!)],pageInfo:{hasNextPage:false,endCursor:null},didFallback:false,retrieved_at:'2026-10-25T02:00:00Z'});
      if(url.pathname.endsWith('/reviews'))return Response.json({reviews:[{id:url.pathname,comment:'Synthetic course feedback',date:'2026-01-01',class:' cSe  240 '}],pageInfo:{hasNextPage:false,endCursor:null},retrieved_at:'2026-10-25T02:00:00Z'});
      const index=Number(Buffer.from(decodeURIComponent(url.pathname.split('/').at(-1)!),'base64').toString().split('-')[1])-1;
      return Response.json({...prof(names[index]!),school:{id:'15723',name:'ASU'}});
    }finally{active--;}
  }),scheduler);
  const transport:typeof fetch=async(_input,init)=>{
    const body=JSON.parse(String(init?.body)),prompt=JSON.parse(body.messages.at(-1).content);
    const isPlan=Boolean(body.response_format?.json_schema?.schema?.properties?.tasks);
    let content:string;
    if(isPlan){
      assert.equal(prompt.conversation[0].tasks[0].catalog,'240');
      content=JSON.stringify({tasks:[],clarification:'What are your priorities?',directAnswer:null,refresh:false});
    }else{
      assert.equal(prompt.evidence.filter((e:Evidence)=>e.kind==='review_corpus').length,2);
      content='I’d lean toward Erik based on the CSE 240 feedback; Eric is another option. The sample is small.';
    }
    return Response.json({id:'test',provider:'Relace',model:config.OPENROUTER_MODEL,object:'chat.completion',created:1,
      choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}});
  };
  try{
    const task:ResearchTask={kind:'catalog',subject:'CSE',catalog:'240',semester:'Spring 2027',professor:null,classNumber:null};
    const original={requestId:'first',question:'Who teaches CSE 240 in Spring 2027?',answer:'Erik Trickel and Eric Eckert.',tasks:[task],instructors:names};
    const prior=await memory.begin(room,'student');await memory.finish(room,'student',prior.version,[],original);await memory.delivered(room,'first','ray-message');
    // A different newer topic must not override an explicit reply to the earlier answer.
    const newer=await memory.begin(room,'student');await memory.finish(room,'student',newer.version,[],{...original,requestId:'other',question:'Different question',tasks:[{...task,catalog:'575'}]});
    const reply=await memory.begin(room,'student','ray-message');const context:ResearchContext={turns:reply.turns};
    const answer=await new ResearchAgent(config,source,scheduler,undefined,d=>diagnostics.push(d),transport).answer('Who is the best professor out of these?',undefined,context);
    assert.match(answer,/Erik/);assert.doesNotMatch(answer,/specify|Which course|checked|catalog indexed/i);
    assert.equal(peak,2);assert.equal(diagnostics[0]!.modelCalls,3);
    assert.equal((await memory.begin({...room,channelId:'another-channel'},'student')).turns.length,0);
    assert.equal((await memory.begin(room,'another-student')).turns.length,0);
  }finally{await cleanup(pool,namespace);await pool.end();}
});

test('review retrieval reaches later matching course labels, preserves coverage and prioritizes subject-specific excerpts',async()=>{
  for(const label of ['CSE 510','cse510',' C s E   510 '])assert.equal(normalizeCourseLabel(label),'CSE510');
  let pages=0;
  const f=JSON.parse(await readFile(join(repoRoot,'class_search_api/example_response.json'),'utf8'));f.results[0].catalog_nbr='510';f.results[0].instructors=[{name:'Example Instructor'}];
  const p={id:Buffer.from('Teacher-1').toString('base64'),legacyId:1,firstName:'Example',lastName:'Instructor',department:'Computer Science',avgRating:4,avgDifficulty:3,numRatings:2,wouldTakeAgainPercent:90};
  const source=new ResearchSources(new APIClient('https://asu.test',1000,async()=>Response.json(f)),new APIClient('https://rmp.test',1000,async input=>{
    const url=new URL(String(input));if(url.pathname==='/api/professors')return Response.json({professors:[p],pageInfo:{hasNextPage:false,endCursor:null},didFallback:false,retrieved_at:'2026-10-25T02:00:00Z'});
    if(!url.pathname.endsWith('/reviews'))return Response.json({...p,school:{id:'15723',name:'ASU'}});
    pages++;const second=Boolean(url.searchParams.get('cursor'));
    return Response.json({reviews:[{id:String(pages),class:second?' cSe   510 ':'CSE310',comment:'Synthetic evidence',date:'2026-01-01'}],
      pageInfo:{hasNextPage:!second,endCursor:second?null:'next'},retrieved_at:'2026-10-25T02:00:00Z'});
  }),new ResearchScheduler());
  const signal=AbortSignal.timeout(1000),b={signal,tools:0,models:0,maxTools:12,maxModels:18,refresh:false};
  const result=await source.collectReviews({kind:'reviews',subject:'CSE',catalog:'510',semester:'Spring 2027',professor:'Example Instructor',classNumber:null},b,signal,()=>{});
  const data=result.data as {coverage:{complete:boolean;courseSpecific:number;pagesFetched:number};reviews:{courseRelevance:string}[]};
  assert.equal(pages,2);assert.equal(data.coverage.complete,true);assert.equal(data.coverage.courseSpecific,1);assert.equal(data.reviews[0]!.courseRelevance,'exact_label');
});

test('historical syllabus citations link to the actual source document, not a catalog search',()=>{
  const text=researchLinks([{kind:'syllabus',data:{sourceSemester:'Fall 2026'},sources:['https://syllabus.asu.edu/fall-2026/65678.pdf']} as Evidence]);
  assert.match(text,/Syllabus Link/);assert.match(text,/65678\.pdf/);assert.match(text,/65678/);assert.doesNotMatch(text,/Source 1|classlist/);
});
