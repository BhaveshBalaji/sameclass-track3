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

test('topic discovery fills a semester clarification without requiring an invented course code',()=>{
  const context:ResearchContext={turns:[{requestId:'topic',question:'Find database-related courses next semester.',answer:'Which semester?',tasks:[],instructors:[]}]};
  const plan:ResearchPlan={tasks:[{kind:'discovery',keyword:'database',subject:'',catalog:'',semester:'',professor:null,classNumber:null}],clarification:null,directAnswer:null,refresh:false};
  const validator=Object.create(ResearchAgent.prototype) as {validatePlan:(p:ResearchPlan,q:string,t:string|undefined,c:ResearchContext)=>void};
  validator.validatePlan(plan,'Ray, Spring 2027.',undefined,context);
  assert.equal(plan.clarification,null);assert.equal(plan.tasks[0]!.semester,'Spring 2027');assert.equal(plan.tasks[0]!.catalog,'');
  const omitted=structuredClone(plan);delete omitted.tasks[0]!.keyword;
  validator.validatePlan(omitted,'Ray, Spring 2027.',undefined,context);assert.equal(omitted.tasks[0]!.keyword,'database');
  const absent=structuredClone(plan);absent.tasks[0]!.semester='';
  validator.validatePlan(absent,'Find database-related courses next semester.',undefined,{turns:[]});
  assert.equal(absent.tasks.length,0);assert.match(absent.clarification!,/semester/);
});

test('a newer semester clarification takes precedence over older structured scope',()=>{
  assert.equal(knownScope('Ray, yes.',{turns:[root,{requestId:'new-term',question:'Use Fall 2027.',answer:'Okay',tasks:[],instructors:[]}]}).semester,'Fall 2027');
});

test('official department names resolve to their own subjects rather than broad keyword matches',async()=>{
  const {subjectHints,expandSubjectNames,ASU_SUBJECTS}=await import('../src/research/subjects.js');
  assert.ok(Object.keys(ASU_SUBJECTS).length>300);
  for(const [name,code] of [['Chemistry','CHM'],['Biochemistry','BCH'],['Computer science','CSE'],['Physics','PHY']])assert.deepEqual(subjectHints(name!).map(h=>h.code),[code]);
  assert.equal(expandSubjectNames('Chemistry 113 in Spring 2027'),'CHM 113 in Spring 2027');
  const plan:ResearchPlan={tasks:[{kind:'discovery',keyword:'chemistry',subject:'BCH',catalog:'',semester:'Spring 2027',professor:null,classNumber:null}],clarification:null,directAnswer:null,refresh:false};
  const validator=Object.create(ResearchAgent.prototype) as {validatePlan:(p:ResearchPlan,q:string,t:string|undefined,c:ResearchContext)=>void};
  validator.validatePlan(plan,'Find chemistry courses in Spring 2027.',undefined,{turns:[]});
  assert.equal(plan.tasks[0]!.subject,'CHM');assert.equal(plan.clarification,null);
});
