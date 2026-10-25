import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {parseConfig,repoRoot} from '../src/config/index.js';
import type {Fact,PlanningSession,Outgoing} from '../src/domain/planning.js';
import type {Candidate,Projection,Section,PlanningResearch,OfferingResearch} from '../src/planning/types.js';
import type {Evidence} from '../src/research/types.js';
import {attendanceSession,attendanceProjection,blockedWindows} from '../src/planning/attendance.js';
import {includeCourseFamilies} from '../src/planning/course-family.js';
import {matchCandidates} from '../src/planning/matcher.js';
import {allocate} from '../src/planning/allocate.js';
import {GroupPlanningEngine} from '../src/planning/engine.js';
import {ModelSoftFit} from '../src/planning/soft-fit.js';
import {ResearchScheduler} from '../src/research/scheduler.js';
import {discordContent} from '../src/transport/discord/index.js';
import {PlanningResearchClient} from '../src/planning/research.js';
import {ResearchSources} from '../src/research/sources.js';
import {APIClient} from '../src/integrations/api.js';
import {qualitySignals,officialTopicReasons} from '../src/planning/quality.js';
import {PlanningCatalogClient} from '../src/planning/catalog.js';
import {renderPlan} from '../src/planning/render.js';

const config=parseConfig({OPENROUTER_API_KEY:'test-only'});
const template:Section=JSON.parse(await readFile(join(repoRoot,'class_search_api/example_response.json'),'utf8')).results[0];
const ann='111111111111111111',bhav='222222222222222222';
function fact(field:string,strength:Fact['strength'],values:string[],quote=values.join('; ')):Fact{return {field,strength,values,sources:[{messageId:'test:'+field,quote}]};}
function scenario():PlanningSession{
  return {id:'test:latest',guildId:'test:guild',channelId:'test:room',creatorId:ann,term:'2271',version:1,messages:[],nextOrdinal:0,truncated:false,clarifications:[],participants:{
    [ann]:{userId:ann,name:'Anish',active:true,cursor:0,silenceAsked:false,profile:{version:1,facts:{
      course_count:fact('course_count','hard',['2']),course_family:fact('course_family','hard',['CSE 5xx']),
      unavailability:fact('unavailability','hard',['Mondays 9am-12pm','Tuesdays 9am-4pm','Wednesdays 9am-11am']),
      preferred_times:fact('preferred_times','soft',['lunch free 12-2pm']),topics:fact('topics','soft',['everything except theory']),workload:fact('workload','soft',['easy courses'])}}},
    [bhav]:{userId:bhav,name:'Bhavshu',active:true,cursor:0,silenceAsked:false,profile:{version:1,facts:{
      course_count:fact('course_count','hard',['1']),course_family:fact('course_family','hard',['CSE 5xx']),
      preferred_times:fact('preferred_times','soft',['anytime before 5 PM; anyday'],'I am available anytime before 5 PM, anyday works for me.'),
      topics:fact('topics','soft',['AI/ML','NLP']),workload:fact('workload','soft',['easier course']),quality:fact('quality','soft',['good professor reviews'])}}}}};
}
function section(id:string,catalog:string,days:string[],start:string,end:string,title='Artificial Intelligence'):Section{
  return {...template,class_nbr:id,subject:'CSE',catalog_nbr:catalog,title,term:'2271',instructors:[{name:'Verified Professor'}],open_seats:10,
    class_url:`https://catalog.apps.asu.edu/catalog/classes/classlist?term=2271&subject=CSE&catalogNbr=${catalog}#detailsOpen=${id}-000000`,
    linked_components:{status:'verified',required_class_numbers:[],source_url:template.class_url},
    meeting_intervals:[{days,start,end,start_date:'2027-01-11',end_date:'2027-04-30',status:'scheduled'}]};
}
function projection(session:PlanningSession):Projection{
  return attendanceProjection(session,includeCourseFamilies(session,{queries:[],participants:[{userId:ann,constraints:[{factKey:'preferred_times',kind:'unavailable',understood:true,values:[],min:null,max:null,
    windows:[{days:['MON','TUE','WED','THU','FRI'],start:'12:00',end:'14:00',startDate:null,endDate:null,timezone:'America/Phoenix'}]}]}]}));
}
const rows=()=>[section('90001','511',['TUE'],'09:00','10:15'),section('90002','533',['WED'],'15:00','18:00'),
  section('90003','571',['MON'],'14:00','15:15'),section('90004','575',['WED'],'14:00','15:15','Statistical Machine Learning'),
  section('90005','572',['MON'],'14:30','15:45','Natural Language Processing'),
  {...section('90006','535',[],'00:00','01:00'),meeting_intervals:[]}];
function matched(session:PlanningSession,sections=rows()){const effective=attendanceSession(session);return matchCandidates(effective,projection(effective),sections);}
function record(id:string,kind:string,data:unknown):Evidence{return {id,kind,entity:'Synthetic evidence',status:'ok',retrievedAt:'2026-10-25T02:00:00Z',retrievedAtLocal:'Test time',sources:[kind==='syllabus'?'https://asu.edu/test-syllabus.pdf':'https://www.ratemyprofessors.com/professor/123'],data,limitations:[],reused:false,ageMs:0};}
function researchFor(id:string):OfferingResearch{return {sectionId:id,evidence:[
  record('syllabus-'+id,'syllabus',{text:'Five assignments account for 30%; the midterm accounts for 40%.',pages:[{page:7,text:'Five assignments account for 30%; the midterm accounts for 40%.'}],historical:true,source_term:'2267',sourceSemester:'Fall 2026',same_professor:true}),
  record('reviews-'+id,'review_corpus',{professor:{status:'ok',professor:{avgRating:4.2,avgDifficulty:3.1,numRatings:20}},reviews:[{courseRelevance:'exact_label',comment:'Strict grading but helpful feedback.'}],coverage:{courseSpecific:3,complete:true}})],limitations:[]};}

test('legacy available-before-5 statement becomes hard; Tuesday work and unknown meetings cannot be assigned',()=>{
  const session=scenario(),candidates=matched(session);
  assert.equal(session.participants[bhav]!.profile.facts.preferred_times!.strength,'soft'); // normalization does not rewrite saved history
  assert.deepEqual(blockedWindows(['Tuesdays 9-4pm'])?.map(w=>[w.start,w.end]),[['09:00','16:00']]);
  assert.equal(candidates.find(c=>c.section.class_nbr==='90001')!.fits.find(f=>f.userId===ann)!.status,'conflict');
  assert.equal(candidates.find(c=>c.section.class_nbr==='90002')!.fits.find(f=>f.userId===bhav)!.status,'conflict');
  const plan=allocate(attendanceSession(session),candidates);
  const a=plan.students.find(s=>s.userId===ann)!,b=plan.students.find(s=>s.userId===bhav)!;
  assert.equal(a.candidates.length,2);assert.equal(b.candidates.length,1);assert.equal(plan.sharedPairs,1);
  assert.ok(!a.candidates.some(c=>c.section.class_nbr==='90001'));assert.ok(!b.candidates.some(c=>c.section.class_nbr==='90002'));
  assert.ok(plan.students.every(s=>!s.candidates.some(c=>c.section.class_nbr==='90006')));
  assert.ok(!a.candidates.some(c=>c.section.class_nbr==='90003')||!a.candidates.some(c=>c.section.class_nbr==='90005'));
});
test('no universal class still yields a partial-group plan; same course, overlapping sections and closed labs do not fill extra slots',()=>{
  const session=attendanceSession(scenario()),p=projection(session);
  // No common time: Anish can take Wednesday evening; Bhavshu can take Tuesday morning.
  const candidates=matchCandidates(session,p,[section('91001','571',['WED'],'18:00','19:00'),section('91002','572',['TUE'],'09:00','10:00'),section('91003','571',['WED'],'19:00','20:00')]);
  const plan=allocate(session,candidates);
  assert.equal(plan.sharedPairs,0);assert.equal(plan.students.find(s=>s.userId===ann)!.candidates.length,1);assert.equal(plan.students.find(s=>s.userId===bhav)!.candidates.length,1);
  const lecture=section('91004','575',['MON'],'14:00','15:00'),lab={...section('91005','575',['FRI'],'14:00','15:00'),component:'LAB',open_seats:0};
  lecture.linked_components!.required_class_numbers=['91005'];
  assert.ok(allocate(session,matchCandidates(session,p,[lecture,lab])).students.every(s=>s.candidates.length===0));
});
test('three students can share different pairs of classes without requiring a universal section',()=>{
  const session=scenario(),third='333333333333333333';
  session.participants[ann]!.profile.facts={course_count:fact('course_count','hard',['1']),availability:fact('availability','hard',['Monday 14:00-15:00'])};
  session.participants[bhav]!.profile.facts={course_count:fact('course_count','hard',['2']),flexibility:fact('flexibility','unrestricted',['any weekday time'])};
  session.participants[third]={userId:third,name:'Student C',active:true,cursor:0,silenceAsked:false,profile:{version:1,facts:{course_count:fact('course_count','hard',['1']),availability:fact('availability','hard',['Tuesday 14:00-15:00'])}}};
  const positive=(userId:string,day:'MON'|'TUE')=>({userId,constraints:[{factKey:'availability',kind:'available' as const,understood:true,values:[],min:null,max:null,windows:[{days:[day],start:'14:00',end:'15:00',startDate:null,endDate:null,timezone:'America/Phoenix'}]}]});
  const projected=attendanceProjection(session,{queries:[],participants:[positive(ann,'MON'),positive(third,'TUE'),{userId:bhav,constraints:[{factKey:'flexibility',kind:'unrestricted_time',understood:true,values:[],min:null,max:null,windows:[]}]}]});
  const candidates=matchCandidates(session,projected,[section('91501','571',['MON'],'14:00','15:00'),section('91502','572',['TUE'],'14:00','15:00')]);
  assert.ok(candidates.every(c=>!c.shared));
  const plan=allocate(session,candidates);
  assert.deepEqual(plan.students.map(s=>s.candidates.length),[1,2,1]);assert.equal(plan.sharedPairs,2);
});
test('verified review difficulty affects an expressed easy-workload priority, not another student without that priority',()=>{
  const session=attendanceSession(scenario()),candidate=matched(session,[section('91601','571',['MON'],'14:00','15:00')])[0]!;
  session.participants[bhav]!.profile.facts={topics:fact('topics','soft',['AI'])};
  const before=candidate.fits.map(f=>f.softScore);
  candidate.research={sectionId:'91601',evidence:[record('r','review_corpus',{professor:{status:'ok',professor:{avgRating:2,avgDifficulty:4.5,numRatings:30}},coverage:{courseSpecific:5,complete:true}})],limitations:[]};
  qualitySignals(session,candidate);
  assert.ok(candidate.fits.find(f=>f.userId===ann)!.softScore<before[0]!);assert.equal(candidate.fits.find(f=>f.userId===bhav)!.softScore,before[1]);
});
test('model analysis combines exact syllabus/review evidence; wrong-section and unsolicited schedule recommendations are rejected',async()=>{
  const session=attendanceSession(scenario()),candidate=matched(session,[section('92001','571',['MON'],'14:00','15:00')])[0]!;candidate.research=researchFor('92001');
  const assessor=new ModelSoftFit(config,new ResearchScheduler(),async()=>Response.json({id:'test',provider:'Relace',model:config.OPENROUTER_MODEL,object:'chat.completion',created:1,
    choices:[{index:0,message:{role:'assistant',content:JSON.stringify({assessments:[{sectionId:'92001',evidenceId:'syllabus-92001',quote:'midterm accounts for 40%',note:'A heavily weighted midterm is a workload tradeoff.',userId:bhav,factKey:'workload',fit:'tradeoff'}],
      findings:[{sectionId:'92001',evidenceId:'syllabus-92001',quote:'midterm accounts for 40%',note:'Midterm 40%; five assignments contribute 30%.',category:'grading',caution:true},
        {sectionId:'92001',evidenceId:'reviews-92001',quote:'Strict grading but helpful feedback.',note:'Students mention strict grading.',category:'reviews',caution:true},
        {sectionId:'92001',evidenceId:'syllabus-92001',quote:'midterm accounts for 40%',note:'Choose CSE 511 Tuesday at 9 AM instead.',category:'topics',caution:false},
        {sectionId:'99999',evidenceId:'syllabus-92001',quote:'midterm accounts for 40%',note:'Wrong course.',category:'grading',caution:true}]})},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}));
  const before=candidate.fits.find(f=>f.userId===bhav)!.softScore;
  await assessor.assess(session,[{candidate,text:'',records:candidate.research.evidence}],AbortSignal.timeout(2000));
  assert.equal(candidate.findings!.length,2);assert.equal(candidate.fits.find(f=>f.userId===bhav)!.softScore,before-1.5);
  assert.ok(candidate.findings!.some(f=>f.category==='reviews'));assert.ok(candidate.findings!.some(f=>f.category==='grading'));
});
test('research actually requests details, exact syllabus and professor reviews, preserving other evidence after failure',async()=>{
  const calls:string[]=[];
  const fake={async courseDetails(){calls.push('details');return record('d','course_details',{description:'AI'});},async syllabus(){calls.push('syllabus');throw Error('source unavailable');},
    async collectReviews(){calls.push('reviews');return researchFor('90003').evidence[1]!;}};
  const result=await new PlanningResearchClient(config,fake as unknown as ResearchSources).inspect(rows()[2]!,'2271',AbortSignal.timeout(2000));
  assert.deepEqual(calls.sort(),['details','reviews','syllabus']);assert.ok(result.evidence.some(e=>e.kind==='review_corpus'));assert.ok(result.limitations.length);
});
async function run(parallel:boolean){
  const session=scenario(),scheduler=new ResearchScheduler(4,2);let active=0,peak=0;
  const inspector:PlanningResearch={async inspect(s,_term,signal){return scheduler.run('asu',signal,async()=>{active++;peak=Math.max(peak,active);try{await new Promise(r=>setTimeout(r,45));return researchFor(s.class_nbr);}finally{active--;}});}};
  const engine=new GroupPlanningEngine({async project(s){return projection(s);}},{async search(){return {count:6,total:6,results:rows(),pages_fetched:1,complete:true,stop_reason:'exhausted',retrieved_at:'2026-10-25T02:00:00Z'};}},inspector,{candidates:12,shortlist:4,timeoutMs:4000,parallel},
    {async assess(_s,items){for(const item of items)item.candidate.findings=[{category:'grading',note:'Midterm 40%; five assignments contribute 30%.',quote:'midterm accounts for 40%',evidenceId:'syllabus-'+item.candidate.section.class_nbr,caution:true}];}});
  const start=performance.now(),result=await engine.recommend(session,'Find classes for our group',AbortSignal.timeout(4000));
  return {result,elapsedMs:Math.round(performance.now()-start),peak};
}
test('parallel evidence has identical scoped output and fewer elapsed waits; every student is tagged before the overall summary',async()=>{
  const sequential=await run(false),parallel=await run(true);
  assert.equal(sequential.peak,1);assert.equal(parallel.peak,2);assert.deepEqual(parallel.result,sequential.result);
  const r=parallel.result;
  assert.equal(r.inlineMentions!.length,2);assert.ok(r.text.indexOf('[[ray-member:1]]')<r.text.indexOf('**Overall recommendation**'));
  assert.match(r.text,/historical/);assert.match(r.text,/4.2\/5 rating/);assert.match(r.text,/Midterm 40%/);assert.match(r.text,/\[Syllabus\]/);assert.match(r.text,/\[Reviews\]/);
  assert.doesNotMatch(r.text,/Research ·|Tuesday at 9|alternative Tue/);
  const body:Outgoing={id:'test',text:r.text,mentions:[ann,bhav],inlineMentions:r.inlineMentions,clarificationIds:[]};
  const rendered=discordContent(body,0,body.text);assert.match(rendered.content,new RegExp(`<@${ann}>`));assert.match(rendered.content,new RegExp(`<@${bhav}>`));assert.deepEqual(rendered.users,[ann,bhav]);
  assert.deepEqual(discordContent({...body,mentions:[ann]},1,'[[ray-member:1]]').users,[]);
  console.log(JSON.stringify({benchmark:'controlled 45ms source operations, not live-provider performance',sequentialMs:sequential.elapsedMs,parallelMs:parallel.elapsedMs,sequentialPeak:sequential.peak,parallelPeak:parallel.peak,identicalRecommendations:true}));
});

test('subject and keyword search caches remain isolated, including concurrent lookups',async()=>{
  let calls=0;
  const source=new PlanningCatalogClient(new APIClient('https://asu.test',1000,async input=>{
    calls++;const q=new URL(String(input)).searchParams;
    const row={...section('93001','571',['MON'],'14:00','15:00'),subject:q.get('subject')!,title:q.get('keyword')||'All topics'};
    return Response.json({count:1,total:1,results:[row],complete:true,stop_reason:'exhausted',pages_fetched:1,retrieved_at:'2026-10-25T11:40:00Z'});
  }),new ResearchScheduler());
  const queries=[{term:'2271',subject:'CSE'},{term:'2271',subject:'MAT'},
    {term:'2271',subject:'CSE',catalog:'571',keyword:'AI'},
    {term:'2271',subject:'CSE',catalog:'571',keyword:'robotics'}];
  const results=await Promise.all(queries.map(q=>source.search(q,AbortSignal.timeout(2000))));
  assert.deepEqual(results.map(r=>r.results[0]!.subject),['CSE','MAT','CSE','CSE']);
  assert.deepEqual(results.slice(2).map(r=>r.results[0]!.title),['AI','robotics']);
  await source.search(queries[0]!,AbortSignal.timeout(2000));assert.equal(calls,4);
});

test('bounded research does not drop compatible individual additions from the final plan',async()=>{
  const session=scenario();
  const sections=[section('94001','571',['MON'],'14:00','15:00'),section('94002','575',['WED'],'15:00','16:00')];
  const researched:string[]=[];
  const engine=new GroupPlanningEngine({async project(s){return projection(s);}},{async search(){return {count:2,total:2,results:sections,complete:true,stop_reason:'exhausted',pages_fetched:1,retrieved_at:'2026-10-25T11:40:00Z'};}},
    {async inspect(s){researched.push(s.class_nbr);if(researched.length>1)throw Error('Controlled follow-up source failure');return researchFor(s.class_nbr);}},{candidates:12,shortlist:1,timeoutMs:2000});
  const result=await engine.recommend(session,'Plan courses for us',AbortSignal.timeout(2000));
  assert.equal(researched.length,2);assert.equal(new Set(researched).size,2);
  assert.deepEqual(result.assignments!.map(s=>s.sectionIds.length),[2,1]);
  assert.match(result.text,/Best common course in this plan/);assert.match(result.text,/Your preferences:.*AI\/ML/);
  assert.match(result.text,/Interest\/workload fit is not yet established/);
  assert.match(result.text,/Syllabus: usable text unavailable/);
});

test('individual topic reasons require matching official evidence and never establish easy workload',()=>{
  const session=scenario(),candidate=matched(session,[section('96001','572',['MON'],'14:00','15:00','Data Mining')])[0]!;
  assert.deepEqual(officialTopicReasons(session.participants[bhav]!,candidate),[]);
  candidate.research={sectionId:'96001',evidence:[record('d','course_details',{description:'Data mining techniques: classification, clustering and association.'})],limitations:[]};
  assert.match(officialTopicReasons(session.participants[bhav]!,candidate).join(' '),/classification.*AI\/ML/);
  assert.deepEqual(officialTopicReasons(session.participants[ann]!,candidate),[]);
  assert.doesNotMatch(officialTopicReasons(session.participants[bhav]!,candidate).join(' '),/easy|NLP/);
  const before=candidate.fits.map(f=>f.softScore);qualitySignals(session,candidate);
  assert.equal(candidate.fits.find(f=>f.userId===ann)!.softScore,before[0]);
  assert.equal(candidate.fits.find(f=>f.userId===bhav)!.softScore,before[1]!+2);
  candidate.research.evidence[0]!.status='unavailable';assert.deepEqual(officialTopicReasons(session.participants[bhav]!,candidate),[]);
});

test('partial sharing names the covered students and does not claim an everyone match',()=>{
  const session=attendanceSession(scenario()),third='333333333333333333';
  session.participants[third]={userId:third,name:'Silent Student',active:true,cursor:0,silenceAsked:false,profile:{version:0,facts:{}}};
  const candidates=matched(session,[section('95001','571',['MON'],'14:00','15:00')]);
  const result=renderPlan(session,allocate(session,candidates),candidates,[]);
  assert.match(result.text,/Best partial-group course in this plan/);
  assert.match(result.text,/for Anish \+ Bhavshu/);assert.match(result.text,/No course was selected for everyone/);
  assert.doesNotMatch(result.text,/It meets everyone/);assert.equal(result.assignments!.find(s=>s.userId===third)!.sectionIds.length,0);
});
