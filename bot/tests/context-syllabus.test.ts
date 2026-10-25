import test from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import {ResearchAgent} from '../src/research/agent.js';
import {ResearchMemory} from '../src/persistence/research-context.js';
import {knownScope} from '../src/research/context-scope.js';
import {syllabusView} from '../src/research/syllabus-view.js';
import type {ResearchContext,ResearchPlan,ResearchTurn} from '../src/research/types.js';

const root:ResearchTurn={requestId:'root',question:'Check CSE 445 in Spring 2027.',answer:'Course overview',
  tasks:[{kind:'reviews',subject:'CSE',catalog:'445',semester:'2271',professor:null,classNumber:null}],instructors:[]};

test('known scope fills a missing tool semester instead of re-asking for the supplied course',()=>{
  const context:ResearchContext={turns:[root]},plan:ResearchPlan={tasks:[{kind:'syllabus',subject:'CSE',catalog:'445',semester:'',professor:null,classNumber:null}],clarification:null,directAnswer:null,refresh:false};
  const validator=Object.create(ResearchAgent.prototype) as {validatePlan:(p:ResearchPlan,q:string,t:string|undefined,c:ResearchContext)=>void};
  validator.validatePlan(plan,'what is cse445 about and whats its syllabus?',undefined,context);
  assert.equal(plan.clarification,null);assert.equal(plan.tasks[0]!.semester,'Spring 2027');
  assert.equal(knownScope('what about its syllabus?',context).catalog,'445');
});

test('an explicit reply restores ancestors without inheriting an unrelated newer course',async()=>{
  const child:ResearchTurn={requestId:'child',parentRequestId:'root',question:'What about it?',answer:'Clarification',tasks:[],instructors:[]};
  const pool={async query(sql:string,args:string[]){
    if(sql.startsWith('SELECT turn'))return {rowCount:1,rows:[{turn:args[2]==='root'?root:child}]};
    return {rows:[{version:4,turns:[{...root,requestId:'unrelated',tasks:[{...root.tasks[0]!,catalog:'575'}]}]}]};
  }} as unknown as pg.Pool;
  const history=await new ResearchMemory(pool,'test').begin({guildId:'g',channelId:'c'},'student','child-reply');
  assert.deepEqual(history.turns.map(t=>t.requestId),['root','child']);
  assert.equal(knownScope('whats the syllabus?',{turns:history.turns}).catalog,'445');
});

test('syllabus excerpts cover relevant later passages and never imply that the PDF was cut off',()=>{
  const text='Course introduction. '.repeat(1200)+'\nGRADING AND FINAL EXAM: two exams worth 40 percent.\n'+'Policies. '.repeat(1000);
  const view=syllabusView({text,pages:[{page:1,text:text.slice(0,22000)},{page:2,text:text.slice(22000)}],truncated:false,extractionLimit:100000},'What are the grading and final exam weights?');
  assert.ok(view.pages.some(p=>p.text.includes('two exams worth 40 percent')));
  assert.equal(view.textCoverage.excerptedForModel,true);
  assert.equal(view.textCoverage.extractionTruncated,false);
  assert.equal(view.textCoverage.documentUnchanged,true);
  assert.match(view.coverageExplanation,/original syllabus\/PDF is unchanged/);
});
