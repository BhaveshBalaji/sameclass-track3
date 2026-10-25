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
