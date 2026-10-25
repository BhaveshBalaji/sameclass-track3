import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseConfig,repoRoot } from '../src/config/index.js';
import { APIClient,APIError } from '../src/integrations/api.js';
import { ResearchScheduler } from '../src/research/scheduler.js';
import { ResearchSources } from '../src/research/sources.js';
import { ResearchAgent,type ResearchDiagnostics } from '../src/research/agent.js';
import type { ResearchBudget,ResearchTask,Evidence } from '../src/research/types.js';

const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const budget=():ResearchBudget=>({signal:AbortSignal.timeout(5000),tools:0,models:0,maxTools:12,maxModels:18,refresh:false});
const task:ResearchTask={kind:'syllabus',subject:'CSE',catalog:'575',semester:'Spring 2027',professor:'Example Instructor',classNumber:null};
const fixtures=async()=>({catalog:JSON.parse(await readFile(join(repoRoot,'class_search_api/example_response.json'),'utf8')),
  rmp:JSON.parse(await readFile(join(repoRoot,'rmp_api/example_response.json'),'utf8'))});
test('scheduler overlaps independent work, enforces global/source caps and preserves successful siblings',async()=>{
  const scheduler=new ResearchScheduler(3,2),signal=AbortSignal.timeout(2000);
  let active=0,peak=0;const per:Record<string,number>={},peaks:Record<string,number>={};
  const results=await Promise.allSettled(['asu','asu','asu','rmp','rmp','model'].map((source,i)=>scheduler.run(source,signal,async()=>{
    active++;peak=Math.max(peak,active);per[source]=(per[source]??0)+1;peaks[source]=Math.max(peaks[source]??0,per[source]!);
    try{await delay(15);if(i===2)throw new Error('failing sibling');return i;}
    finally{active--;per[source]!--;}
  })));
  assert.equal(peak,3);assert.ok(Object.values(peaks).every(n=>n<=2));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,5);
  await assert.rejects(scheduler.run('asu',AbortSignal.abort(),async()=>1));
});
test('cache deduplicates in-flight scope, respects refresh and honors source cooldown without retry loops',async()=>{
  const scheduler=new ResearchScheduler(),signal=AbortSignal.timeout(2000);let calls=0;
  const load=async()=>{calls++;await delay(10);return 42;};
  const [a,b]=await Promise.all([scheduler.cached('scope',1000,false,'asu',signal,load),scheduler.cached('scope',1000,false,'asu',signal,load)]);
  assert.equal(a.value,b.value);assert.equal(calls,1);
  assert.equal((await scheduler.cached('scope',1000,false,'asu',signal,load)).reused,true);
  await scheduler.cached('scope',1000,true,'asu',signal,load);assert.equal(calls,2);
  await assert.rejects(scheduler.run('rmp',signal,async()=>{throw new APIError('http',429,500);}));
  await assert.rejects(scheduler.run('rmp',signal,async()=>{calls++;}),/rate limited/);assert.equal(calls,2);
  const api=new APIClient('https://source.test',1000,async()=>new Response('',{status:429,headers:{'retry-after':'3'}}));
  await assert.rejects(api.health(),e=>e instanceof APIError&&e.retryAfterMs===3000);
});
test('a cancelled caller does not release the slot until underlying work settles',async()=>{
  const scheduler=new ResearchScheduler(1,1),controller=new AbortController();let peak=0,active=0;
  const first=scheduler.cached('slow',1000,false,'asu',controller.signal,async()=>{active++;peak=Math.max(peak,active);await delay(30);active--;return 1;});
  controller.abort();await assert.rejects(first);
  await scheduler.run('rmp',AbortSignal.timeout(1000),async()=>{active++;peak=Math.max(peak,active);active--;});
  assert.equal(peak,1);
});
test('syllabus tries exact identity first and labels historical/different-instructor fallback and OCR',async()=>{
  const f=await fixtures(),paths:string[]=[];
  const source=new ResearchSources(new APIClient('https://asu.test',1000,async input=>{
    const u=new URL(String(input));paths.push(u.pathname);
    if(u.pathname==='/api/search')return Response.json(f.catalog);
    if(u.pathname==='/api/syllabus/text')return new Response('',{status:404});
    if(u.pathname==='/api/syllabus_url')return Response.json({download_url:'https://asu.edu/historical.pdf'});
    return Response.json({status:'ok',requested_term:'2271',source_term:'2267',course:'CSE 575',class_nbr:'88888',instructors:['Other Instructor'],same_professor:false,
      historical:true,warning:'Historical syllabus',search_complete:false,retrieved_at:'2026-10-25T02:00:00+00:00',text:'Exams 40%',pages:[{page:1,text:'Exams 40%'}],truncated:true,extraction_status:'ok'});
  }),new APIClient('https://rmp.test',1000),new ResearchScheduler());
  const recorded:Evidence[]=[];const b=budget(),result=await source.syllabus(task,b,b.signal,e=>recorded.push(e));
  assert.deepEqual(paths,['/api/search','/api/syllabus/text','/api/syllabus/lookup','/api/syllabus_url']);
  assert.equal(result.sources[0],'https://asu.edu/historical.pdf');
  assert.equal(result.status,'partial');assert.ok(result.limitations.some(s=>/does not match/.test(s)));
  assert.ok(result.limitations.some(s=>/Historical/.test(s)));assert.ok(!result.sources[0]!.includes('#detailsOpen'));
  assert.equal(recorded[0]!.kind,'catalog');
  const ocr=new ResearchSources(new APIClient('https://asu.test',1000,async input=>String(input).includes('/api/search')?Response.json(f.catalog):Response.json({class_nbr:'99999',source_term:'2271',retrieved_at:'2026-10-25T02:00:00Z',text:'',pages:[{page:null,text:''}],ocr_required:true,extraction_status:'no_extractable_text'})),new APIClient('https://rmp.test',1000),new ResearchScheduler());
  const result2=await ocr.syllabus(task,budget(),AbortSignal.timeout(1000),()=>{});
  assert.equal(result2.status,'unavailable');assert.ok(result2.limitations.some(s=>/OCR/.test(s)));
});
test('professor identity requires correct school/department; review pages preserve course labels and first-page success',async()=>{
  const f=await fixtures();let wrongSchool=true;
  const source=new ResearchSources(new APIClient('https://asu.test',1000,async()=>Response.json(f.catalog)),new APIClient('https://rmp.test',1000,async input=>{
    const u=new URL(String(input));
    if(u.pathname==='/api/professors')return Response.json(f.rmp);
    if(u.pathname.endsWith('/reviews')){
      if(u.searchParams.get('cursor'))return new Response('',{status:502});
      return Response.json({reviews:[{id:'r1',comment:'Synthetic review',class:'CSE575',date:'2025-04-01'}],pageInfo:{hasNextPage:true,endCursor:'next'},retrieved_at:'2026-10-25T02:00:00Z'});
    }
    return Response.json({...f.rmp.professors[0],school:{id:wrongSchool?'wrong':'15723',name:'ASU'},retrieved_at:'2026-10-25T02:00:00Z'});
  }),new ResearchScheduler());
  const b=budget(),bad=await source.findProfessor(task,b,b.signal,()=>{});assert.equal(bad.status,'ambiguous');
  await assert.rejects(source.reviewPage(task,bad,'',b,b.signal),/identity/);
  wrongSchool=false;b.refresh=true;
  const good=await source.findProfessor(task,b,b.signal,()=>{});assert.equal(good.status,'ok');
  const first=await source.reviewPage(task,good,'',b,b.signal);
  assert.match(JSON.stringify(first.data),/exact_label/);
  await assert.rejects(source.reviewPage(task,good,'next',b,b.signal));
  assert.equal((first.data as {reviews:unknown[]}).reviews.length,1);
});
test('real graph dispatch synthesizes a question-specific answer from validated evidence',async()=>{
  const f=await fixtures(),config=parseConfig({OPENROUTER_API_KEY:'synthetic-key'}),scheduler=new ResearchScheduler();
  let sourceCalls=0,diagnostic:ResearchDiagnostics|undefined;
  const source=new ResearchSources(new APIClient('https://asu.test',1000,async()=>{sourceCalls++;return Response.json(f.catalog);}),new APIClient('https://rmp.test',1000),scheduler);
  const transport:typeof fetch=async(_input,init)=>{
    const body=JSON.parse(String(init?.body));let content:string|null=null,tool_calls:unknown[]|undefined;
    const schema=body.response_format?.json_schema?.schema;
    if(schema?.properties?.tasks)content=JSON.stringify({tasks:[{...task,kind:'catalog'}],clarification:null,refresh:false});
    else if(!body.tools?.length){
      const prompt=JSON.parse(body.messages.at(-1).content),e=prompt.workers[0].evidence[0];
      content=`Example Instructor teaches this course. [${e.id}]`;
    }else if(body.messages.some((m:{role:string})=>m.role==='tool'))content='Evidence collected.';
    else tool_calls=[{id:'tool1',type:'function',function:{name:'search_sections',arguments:'{}'}}];
    return Response.json({id:'fake',provider:'Relace',model:config.OPENROUTER_MODEL,object:'chat.completion',created:1,
      choices:[{index:0,message:{role:'assistant',content,...(tool_calls?{tool_calls}:{})},finish_reason:tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}});
  };
  const agent=new ResearchAgent(config,source,scheduler,undefined,data=>{diagnostic=data;},transport);
  const answer=await agent.answer('Who teaches CSE 575 in Spring 2027?');
  assert.match(answer,/Example Instructor/);assert.match(answer,/Class Link/);assert.equal(sourceCalls,1);
  assert.equal(diagnostic?.modelCalls,3);assert.doesNotMatch(answer,/Seats:|Meeting times/);
});
