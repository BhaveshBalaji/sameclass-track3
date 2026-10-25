import type {Config} from '../config/index.js';
import {semesterName} from '../domain/semester.js';
import {safeResearchError,type Evidence,type ResearchBudget,type ResearchTask} from '../research/types.js';
import {ResearchSources} from '../research/sources.js';
import type {OfferingResearch,PlanningResearch,Section} from './types.js';

/** Fetch scoped evidence directly. Independent tools do not write their own competing recommendations. */
export class PlanningResearchClient implements PlanningResearch{
  constructor(private config:Config,private sources:ResearchSources){}
  async inspect(section:Section,term:string,parent:AbortSignal,shared?:ResearchBudget):Promise<OfferingResearch>{
    const signal=AbortSignal.any([parent,AbortSignal.timeout(this.config.RESEARCH_WORKER_TIMEOUT_MS)]);
    const budget=shared??{signal,tools:0,models:0,maxTools:this.config.RESEARCH_MAX_SOURCE_CALLS,maxModels:0,refresh:false};
    const records=new Map<string,Evidence>(),limitations:string[]=[];
    const record=(e:Evidence)=>{records.set(e.id,e);};
    const base:ResearchTask={kind:'details',subject:section.subject,catalog:section.catalog_nbr,semester:semesterName(term),
      classNumber:section.class_nbr,professor:section.instructors.length===1?section.instructors[0]!.name:null,delivery:/online/i.test(section.campus??'')?'O':'A'};
    const jobs=[()=>this.sources.courseDetails(base,budget,signal),()=>this.sources.syllabus({...base,kind:'syllabus'},budget,signal,record),
      ...section.instructors.slice(0,2).map(i=>()=>this.sources.collectReviews({...base,kind:'reviews',professor:i.name},budget,signal,record,Math.min(3,this.config.RESEARCH_REVIEW_MAX_PAGES)))];
    if(!section.instructors.length)limitations.push('Instructor not listed; professor reviews unavailable.');
    if(section.instructors.length>2)limitations.push('Only two listed instructors researched within this request.');
    const results=await Promise.allSettled(jobs.map(job=>job()));
    for(const result of results)if(result.status==='fulfilled')record(result.value);else limitations.push(safeResearchError(result.reason));
    return {sectionId:section.class_nbr,evidence:[...records.values()].sort((a,b)=>a.id.localeCompare(b.id)),limitations:[...new Set(limitations)]};
  }
}
