import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseConfig,repoRoot} from '../src/config/index.js';
import {APIClient} from '../src/integrations/api.js';
import {ResearchAgent} from '../src/research/agent.js';
import {ResearchSources} from '../src/research/sources.js';
import {ResearchScheduler} from '../src/research/scheduler.js';

test('CSE 445 slot reply discovers all instructors, resolves fuzzy paginated matches and makes a second tool round',async()=>{
  const config=parseConfig({OPENROUTER_API_KEY:'test-only'}),scheduler=new ResearchScheduler();
  const fixture=JSON.parse(await readFile(join(repoRoot,'class_search_api/example_response.json'),'utf8'));
  const names=['Yeonjung Lee','Yinong Chen'];
  fixture.results=names.map((name,index)=>({...fixture.results[0],subject:'CSE',catalog_nbr:'445',course:'CSE 445',class_nbr:String(90000+index),instructors:[{name}]}));fixture.count=2;
  let searchPages=0,descriptionCalls=0,active=0,peak=0;
  const profile=(name:string)=>({id:Buffer.from(`Teacher-${names.indexOf(name)+1}`).toString('base64'),legacyId:names.indexOf(name)+1,
    firstName:name.split(' ')[0],lastName:name.split(' ')[1],department:'Computer Science',numRatings:1,avgRating:4,avgDifficulty:3,wouldTakeAgainPercent:80});
  const source=new ResearchSources(new APIClient('https://asu.test',1000,async input=>{
    if(String(input).includes('course_description')){descriptionCalls++;return Response.json({description:'Distributed software development.',prerequisites:null,course:{SUBJECT:'CSE',CATALOGNBR:'445'},retrieved_at:'2026-10-25T02:00:00Z'});}
    return Response.json(fixture);
  }),new APIClient('https://rmp.test',1000,async input=>{
    const url=new URL(String(input));active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));
    try{
      if(url.pathname==='/api/professors'){
        searchPages++;const more=!url.searchParams.get('cursor');
        return Response.json({professors:more?[profile(url.searchParams.get('q')!)]:[],pageInfo:{hasNextPage:more,endCursor:more?'next':null},didFallback:false,retrieved_at:'2026-10-25T02:00:00Z'});
      }
      if(url.pathname.endsWith('reviews'))return Response.json({reviews:[{id:url.pathname,class:' cSe  445 ',comment:'Synthetic feedback',date:'2026-01-01'}],pageInfo:{hasNextPage:false,endCursor:null},retrieved_at:'2026-10-25T02:00:00Z'});
      const index=Number(Buffer.from(decodeURIComponent(url.pathname.split('/').at(-1)!),'base64').toString().split('-')[1])-1;
      return Response.json({...profile(names[index]!),school:{id:'15723',name:'ASU'}});
    }finally{active--;}
  }),scheduler);
  let assessed=false;
  const transport:typeof fetch=async(_input,init)=>{
    const body=JSON.parse(String(init?.body)),prompt=JSON.parse(body.messages.at(-1).content);
    let content:string;
    if(body.response_format?.json_schema?.schema?.properties?.tasks){
      if(prompt.attempted){assessed=true;assert.equal(prompt.evidence.filter((e:{kind:string})=>e.kind==='review_corpus').length,2);
        content=JSON.stringify({tasks:[{kind:'details',subject:'CSE',catalog:'445',semester:'Spring 2027',professor:null,classNumber:null}],clarification:null,directAnswer:null,refresh:false});
      }else content=JSON.stringify({tasks:[{kind:'catalog',subject:'CSE',catalog:'445',semester:'Spring 2027',professor:null,classNumber:null}],clarification:null,directAnswer:null,refresh:false});
    }else{
      assert.ok(prompt.evidence.some((e:{kind:string})=>e.kind==='course_details'));
      assert.equal(prompt.evidence.filter((e:{kind:string})=>e.kind==='review_corpus').length,2);
      content='**CSE 445**\n- **Yinong Chen:** Course-specific feedback retrieved.\n- **Yeonjung Lee:** Course-specific feedback retrieved.\n\n**Takeaway:** Consider it for distributed development.';
    }
    return Response.json({id:'test',provider:'Relace',model:config.OPENROUTER_MODEL,object:'chat.completion',created:1,
      choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}});
  };
  const result=await new ResearchAgent(config,source,scheduler,undefined,()=>{},transport).answer('Spring 2027. Any professor is fine; get their reviews and tell me whether I should take it.',undefined,
    {turns:[{requestId:'original',question:'Get professor reviews for CSE 445.',answer:'Which semester?',tasks:[],instructors:[]}]});
  assert.equal(assessed,true);assert.equal(descriptionCalls,1);assert.equal(searchPages,4);assert.equal(peak,2);
  assert.match(result,/\*\*Yinong Chen:\*\*/);assert.doesNotMatch(result,/Which professor|Which course/);
});

test('topic clarification retains its goal, then discovers real course identities for mixed syllabus and review research',async()=>{
  const config=parseConfig({OPENROUTER_API_KEY:'test-only'}),scheduler=new ResearchScheduler();
  const fixture=JSON.parse(await readFile(join(repoRoot,'class_search_api/example_response.json'),'utf8'));
  fixture.results=[{...fixture.results[0],subject:'CSE',catalog_nbr:'412',title:'Database Management',instructors:[{name:'Example Instructor'}]}];fixture.count=1;
  let calls=0,syllabi=0,reviews=0;
  const evidence=(kind:string,data:unknown)=>({id:kind,kind,entity:'CSE 412 / Spring 2027',status:'ok' as const,retrievedAt:fixture.retrieved_at,retrievedAtLocal:'test',sources:[],data,limitations:[],reused:false,ageMs:0});
  const source={
    discover:async()=>{calls++;return evidence('discovery',fixture);},
    search:async()=>evidence('catalog',fixture),
    syllabus:async()=>{syllabi++;return evidence('syllabus',{text:'Synthetic exam policy',sourceSemester:'Spring 2027'});},
    collectReviews:async()=>{reviews++;return evidence('review_corpus',{reviews:[],coverage:{complete:true}});},
  } as unknown as ResearchSources;
  let step=0;
  const transport:typeof fetch=async(_input,init)=>{
    const body=JSON.parse(String(init?.body)),prompt=JSON.parse(body.messages.at(-1).content);
    let content:string;
    if(body.response_format?.json_schema?.schema?.properties?.tasks){
      let tasks:unknown[];
      if(prompt.attempted){
        assert.equal(prompt.evidence[0].courses[0].catalog_nbr,'412');
        tasks=['syllabus','reviews'].map(kind=>({kind,subject:'CSE',catalog:'412',semester:'Spring 2027',professor:null,classNumber:null}));
      }else{
        if(step++)assert.match(prompt.pendingRequest,/database/);
        tasks=[{kind:'discovery',keyword:'database',subject:'',catalog:'',semester:'',professor:null,classNumber:null}];
      }
      content=JSON.stringify({tasks,clarification:null,directAnswer:null,refresh:false});
    }else{
      assert.ok(prompt.evidence.some((e:{kind:string})=>e.kind==='syllabus'));assert.ok(prompt.evidence.some((e:{kind:string})=>e.kind==='review_corpus'));
      content='CSE 412 — Database Management. Synthetic syllabus and review evidence.';
    }
    return Response.json({id:'test',provider:'Relace',model:config.OPENROUTER_MODEL,object:'chat.completion',created:1,
      choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}});
  };
  const agent=new ResearchAgent(config,source,scheduler,undefined,()=>{},transport);
  const first={turns:[]} as import('../src/research/types.js').ResearchContext;
  const question='Find database-related courses next semester, including syllabus and RMP reviews.';
  assert.match(await agent.answer(question,undefined,first),/semester/);assert.equal(calls,0);
  const follow={turns:[{requestId:'first',question,answer:'Which semester?',tasks:first.result!.tasks,instructors:[],pendingQuestion:first.result!.pendingQuestion}]} as import('../src/research/types.js').ResearchContext;
  const answer=await agent.answer('Ray, Spring 2027.',undefined,follow);
  assert.match(answer,/CSE 412/);assert.equal(calls,1);assert.equal(syllabi,1);assert.equal(reviews,1);assert.equal(follow.result!.pendingQuestion,undefined);
});

test('keyword discovery sends the ASU keywords filter and preserves distinct courses across departments',async()=>{
  const fixture=JSON.parse(await readFile(join(repoRoot,'class_search_api/example_response.json'),'utf8'));
  const row=fixture.results[0];fixture.results=[{...row,subject:'CSE',catalog_nbr:'412'}, {...row,subject:'CSE',catalog_nbr:'412'}, {...row,subject:'IFT',catalog_nbr:'200'}];fixture.count=3;
  const scheduler=new ResearchScheduler();
  const source=new ResearchSources(new APIClient('https://asu.test',1000,async input=>{
    const url=new URL(String(input));assert.equal(url.searchParams.get('keywords'),'database');assert.equal(url.searchParams.has('subject'),false);assert.equal(url.searchParams.has('catalog_nbr'),false);
    return Response.json(fixture);
  }),new APIClient('https://rmp.test',1000,async()=>assert.fail('discovery needs no RMP call')),scheduler);
  const signal=new AbortController().signal;
  const e=await source.discover({kind:'discovery',keyword:'database',subject:'',catalog:'',semester:'Spring 2027',professor:null,classNumber:null},{signal,tools:0,models:0,maxTools:2,maxModels:3,refresh:false},signal);
  assert.deepEqual((e.data as {results:{subject:string}[]}).results.map(r=>r.subject),['CSE','IFT']);
});

test('department discovery fetches deeper coverage, keeps all course summaries and aggregates instructors',async()=>{
  const fixture=JSON.parse(await readFile(join(repoRoot,'class_search_api/example_response.json'),'utf8'));
  const row=fixture.results[0];fixture.results=Array.from({length:16},(_,i)=>({...row,subject:'CHM',catalog_nbr:String(100+i),title:'Synthetic chemistry '+i,instructors:[{name:'Teacher A'}]}));
  fixture.results.push({...fixture.results[0],class_nbr:'99999',instructors:[{name:'Teacher B'}]});fixture.count=17;fixture.complete=true;
  const scheduler=new ResearchScheduler();
  const source=new ResearchSources(new APIClient('https://asu.test',1000,async input=>{
    const url=new URL(String(input));assert.equal(url.searchParams.get('subject'),'CHM');assert.equal(url.searchParams.has('keywords'),false);assert.equal(url.searchParams.get('max_pages'),'10');
    return Response.json(fixture);
  }),new APIClient('https://rmp.test',1000,async()=>assert.fail('not requested')),scheduler);
  const signal=new AbortController().signal;
  const e=await source.discover({kind:'discovery',keyword:'chemistry',subject:'',catalog:'',semester:'Spring 2027',professor:null,classNumber:null},{signal,tools:0,models:0,maxTools:2,maxModels:3,refresh:false},signal);
  const data=e.data as {results:{instructors:{name:string}[]}[];distinctCourses:number};
  assert.equal(e.status,'ok');assert.equal(data.results.length,16);assert.equal(data.distinctCourses,16);
  assert.deepEqual(data.results[0]!.instructors.map(i=>i.name),['Teacher A','Teacher B']);
});
