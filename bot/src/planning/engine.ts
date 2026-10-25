import {END,START,StateGraph,StateSchema} from '@langchain/langgraph';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import type {PlanningSession} from '../domain/planning.js';
import {semesterName} from '../domain/semester.js';
import type {CourseResearch} from '../application/catalog.js';
import type {ResearchBudget} from '../research/types.js';
import {matchCandidates} from './matcher.js';
import {includeCourseFamilies} from './course-family.js';
import {discoveryRelevance} from './discovery-relevance.js';
import {attendanceSession,attendanceProjection} from './attendance.js';
import {qualitySignals} from './quality.js';
import {allocate,eligible} from './allocate.js';
import {renderPlan} from './render.js';
import type {Candidate,GroupPlanner,PlanningCatalog,PlanningProjection,Projection,Recommendation,Section,SoftFitAssessor,PlanningQuery,PlanningResearch,OfferingResearch} from './types.js';

export function isGroupRequest(text:string){return /\b(?:together|for (?:all of us|our group)|shared (?:classes|courses|options)|our (?:schedules|requirements)|group plan|plan (?:classes|courses) for us)\b/i.test(text);}
interface Limits {candidates:number;shortlist:number;timeoutMs:number;sourceCalls?:number;parallel?:boolean}
export class GroupPlanningEngine implements GroupPlanner{
  constructor(private projector:PlanningProjection,private catalog:PlanningCatalog,private research?:PlanningResearch|CourseResearch,
    private limits:Limits={candidates:12,shortlist:4,timeoutMs:90000},private softFit?:SoftFitAssessor){}
  async recommend(original:PlanningSession,question:string,parentSignal:AbortSignal):Promise<Recommendation>{
    const session=attendanceSession(original),signal=AbortSignal.any([parentSignal,AbortSignal.timeout(this.limits.timeoutMs)]);
    const budget:ResearchBudget={signal,tools:0,models:0,maxTools:this.limits.sourceCalls??24,maxModels:0,refresh:false};
    let projection:Projection={queries:[],participants:[]},sections:Section[]=[],ranked:Candidate[]=[],notes:string[]=[];
    const graph=new StateGraph(new StateSchema({requestId:z.string(),status:z.string()}))
      .addNode('interpret',async()=>{
        signal.throwIfAborted();projection=attendanceProjection(session,includeCourseFamilies(session,await this.projector.project(session,question,signal)));
        return {status:'interpreted'};
      })
      .addNode('catalog',async()=>{
        const campusFacts=projection.participants.flatMap(p=>p.constraints.filter(c=>c.kind==='campus'&&c.understood));
        const online=campusFacts.some(c=>c.values.some(v=>/online/i.test(v)));
        const allOnline=campusFacts.length>0&&campusFacts.every(c=>c.values.length>0&&c.values.every(v=>/online/i.test(v)));
        const deliveries:('A'|'O')[]=online?(allOnline?['O']:['A','O']):['A'];
        const queries:PlanningQuery[]=projection.queries.flatMap(q=>deliveries.map(delivery=>({term:session.term,subject:q.subject||undefined,catalog:q.catalog||undefined,keyword:q.keyword||undefined,delivery})));
        const results=await Promise.allSettled(queries.slice(0,4).map(q=>this.catalog.search(q,signal)));
        if(queries.length>4)notes.push('Catalog query limit.');
        for(const result of results){
          if(result.status==='rejected'){notes.push('One catalog lookup failed.');continue;}
          if(!result.value.complete)notes.push('Partial catalog coverage.');
          sections.push(...result.value.results);
        }
        sections=[...new Map(sections.map(s=>[`${s.term}:${s.class_nbr}`,s])).values()];
        return {status:'retrieved'};
      })
      .addNode('match',()=>{
        signal.throwIfAborted();ranked=matchCandidates(session,projection,sections);
        const count=(c:Candidate)=>c.fits.filter(f=>eligible(c,f.userId)).length;
        ranked.sort((a,b)=>count(b)-count(a)||discoveryRelevance(session,b.section)-discoveryRelevance(session,a.section)
          ||b.fits.reduce((n,f)=>n+f.softScore,0)-a.fits.reduce((n,f)=>n+f.softScore,0));
        if(ranked.length>this.limits.candidates)notes.push('Candidate limit.');
        ranked=ranked.slice(0,this.limits.candidates);
        return {status:'matched'};
      })
      .addNode('research',async()=>{
        if(!this.research||!this.limits.shortlist)return {status:'matched_without_research'};
        const provisional=allocate(session,ranked);
        const assigned=provisional.students.flatMap(s=>s.candidates);
        const shortlist=[...new Set([...assigned,...ranked])].filter(c=>c.fits.some(f=>eligible(c,f.userId))).slice(0,this.limits.shortlist);
        const inspect=async(candidate:Candidate):Promise<OfferingResearch>=>{
          const provider=this.research!;
          if('inspect' in provider)return provider.inspect(candidate.section,session.term,signal,budget);
          // Compatibility for test/adaptor callers. Free prose is never rendered or trusted as evidence.
          await provider.answer(`For ${candidate.section.subject} ${candidate.section.catalog_nbr} in ${semesterName(session.term)}, section ${candidate.section.class_nbr}, retrieve assessment and review evidence only.`,session.term,{turns:[],signal});
          return {sectionId:candidate.section.class_nbr,evidence:[],limitations:['Structured evidence unavailable.']};
        };
        const enrich=async(batch:Candidate[])=>{
          if(!batch.length)return;
          const results:PromiseSettledResult<OfferingResearch>[]=[];
          if(this.limits.parallel===false){for(const candidate of batch){try{results.push({status:'fulfilled',value:await inspect(candidate)});}catch(reason){results.push({status:'rejected',reason});}}}
          else results.push(...await Promise.allSettled(batch.map(inspect)));
          results.forEach((result,index)=>{
            const candidate=batch[index]!;
            candidate.research=result.status==='fulfilled'&&result.value.sectionId===candidate.section.class_nbr?result.value:
              {sectionId:candidate.section.class_nbr,evidence:[],limitations:['Section research unavailable or mismatched.']};
            qualitySignals(session,candidate);
          });
          if(this.softFit){try{await this.softFit.assess(session,batch.map(candidate=>({candidate,text:'',records:candidate.research!.evidence})),signal);}catch{notes.push('Evidence analysis unavailable.');}}
        };
        await enrich(shortlist);
        // Evidence may change the selected plan. Fetch the newly assigned choices
        // once within the SAME deadline/source budget instead of presenting them
        // with sources from a different shortlist. Do not retry failed candidates.
        const followup=[...new Set(allocate(session,ranked).students.flatMap(s=>s.candidates))].filter(c=>!c.research).slice(0,this.limits.shortlist);
        await enrich(followup);
        if(shortlist.length<ranked.filter(c=>c.fits.some(f=>eligible(c,f.userId))).length)notes.push('Research shortlist limit.');
        return {status:'researched'};
      }).addEdge(START,'interpret').addEdge('interpret','catalog').addEdge('catalog','match').addEdge('match','research').addEdge('research',END).compile();
    try{await graph.invoke({requestId:randomUUID(),status:'started'});}catch(error){parentSignal.throwIfAborted();if(!ranked.length)throw error;notes.push('Optional research deadline reached.');}
    parentSignal.throwIfAborted();
    if(!projection.queries.length)return {text:'A subject/level, topic or specific course is enough to start discovery. I could not derive a search from the saved facts yet; an approved list is not required.',sectionIds:[]};
    if(!ranked.length)return {text:'No usable sections were returned in this bounded search. Your requirements are unchanged.',sectionIds:[]};
    // Rank and present the same scoped evidence. Never append competing worker recommendation paragraphs.
    // Research enriches candidates; the source budget must not erase otherwise
    // compatible individual alternatives or prevent filling a student's request.
    return renderPlan(session,allocate(session,ranked),ranked,notes);
  }
}
