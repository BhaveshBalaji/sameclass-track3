import {SYLLABUS_EXTRACTION_LIMIT} from './syllabus-view.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { APIClient, APIError } from '../integrations/api.js';
import { catalogSchema, type CatalogResult } from '../integrations/catalog.js';
import { catalogUrl } from '../application/catalog.js';
import { semesterCode, semesterName } from '../domain/semester.js';
import { ResearchLimit, ResearchScheduler } from './scheduler.js';
import { safeResearchError, type Evidence, type ResearchTask, type ResearchBudget } from './types.js';

const stamp=z.iso.datetime({offset:true});
const pageInfo=z.object({hasNextPage:z.boolean(),endCursor:z.string().nullable()});
const professor=z.object({id:z.string(),legacyId:z.number().int(),firstName:z.string(),lastName:z.string(),department:z.string().nullable(),
  avgRating:z.number().nullable(),avgDifficulty:z.number().nullable(),numRatings:z.number().int(),wouldTakeAgainPercent:z.number().nullable(),
  school:z.object({id:z.string(),name:z.string()}).optional(),retrieved_at:stamp.optional()});
const professors=z.object({professors:z.array(professor),pageInfo,didFallback:z.boolean(),retrieved_at:stamp});
const reviews=z.object({reviews:z.array(z.object({id:z.string(),comment:z.string().nullable(),date:z.string().nullable(),class:z.string().nullable(),
  helpfulRating:z.number().nullable().optional(),clarityRating:z.number().nullable().optional(),difficultyRating:z.number().nullable().optional(),
  ratingTags:z.union([z.array(z.string()),z.string()]).nullable().optional(),grade:z.string().nullable().optional()}).passthrough()),pageInfo,retrieved_at:stamp});
const documentUrl=z.url().refine(value=>{const u=new URL(value),h=u.hostname;return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&(h==='asu.edu'||h.endsWith('.asu.edu')||h.endsWith('.amazonaws.com')||h==='docs.google.com');});
const extracted={download_url:documentUrl.nullable().optional(),text:z.string().nullable().optional(),pages:z.array(z.object({page:z.number().nullable().optional(),text:z.string().optional()}).passthrough()).optional(),
  truncated:z.boolean().optional(),ocr_required:z.boolean().optional(),extraction_status:z.string().nullable().optional()};
const exactSyllabus=z.object({class_nbr:z.string(),source_term:z.string(),retrieved_at:stamp,...extracted});
const fallbackSyllabus=z.object({status:z.enum(['ok','not_found','incomplete','unavailable']),requested_term:z.string(),course:z.string(),
  source_term:z.string().nullable().optional(),class_nbr:z.string().regex(/^\d+$/).optional(),instructors:z.array(z.string()).optional(),same_professor:z.boolean().nullable().optional(),
  historical:z.boolean().nullable().optional(),warning:z.string().nullable().optional(),search_complete:z.boolean(),retrieved_at:stamp,...extracted});
const details=z.object({description:z.string().nullable(),prerequisites:z.string().nullable(),course:z.record(z.string(),z.unknown()),retrieved_at:stamp});
export const normalizeCourseLabel=(value:string)=>value.normalize('NFKC').replace(/[^a-z0-9]/gi,'').toUpperCase();
const normalizedName=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');

export class ResearchSources {
  constructor(private asu:APIClient,private rmp:APIClient,readonly scheduler:ResearchScheduler,
    private candidates=12,private seatsTtl=120000,private evidenceTtl=86400000){}
  private async read<T>(key:string,source:'asu'|'rmp',ttl:number,budget:ResearchBudget,signal:AbortSignal,load:()=>Promise<T>) {
    return this.scheduler.cached(key,ttl,budget.refresh,source,signal,()=>{
      if(++budget.tools>budget.maxTools)throw new ResearchLimit('Research request limit reached; remaining evidence is unavailable.');
      return load();
    });
  }
  private evidence(key:string,kind:string,task:ResearchTask,data:unknown,at:string,sources:string[],meta:{reused:boolean;ageMs:number},limitations:string[]=[],status:Evidence['status']='ok'):Evidence {
    return {id:`E${createHash('sha256').update(key).digest('hex').slice(0,12)}`,kind,entity:`${task.subject} ${task.catalog} / ${task.semester}${task.professor?` / ${task.professor}`:''}`,
      status,retrievedAt:at,retrievedAtLocal:new Date(at).toLocaleString('en-US',{timeZone:'America/Phoenix',timeZoneName:'short'}),sources,data,limitations,...meta};
  }
  async search(task:ResearchTask,budget:ResearchBudget,signal:AbortSignal):Promise<Evidence> {
    const term=semesterCode(task.semester),key=`catalog:${term}:${task.subject}:${task.catalog}${task.delivery==='O'?':O':''}`;
    const result=await this.read(key,'asu',this.seatsTtl,budget,signal,()=>this.asu.get('/api/search',catalogSchema,
      {term,subject:task.subject,catalog_nbr:task.catalog,search_type:'all',max_pages:'2',campus_or_online_selection:task.delivery??'A'},signal));
    const data=result.value;
    if(data.count!==data.results.length||data.results.some(s=>s.term!==term||s.subject!==task.subject||s.catalog_nbr!==task.catalog))throw new APIError('invalid_response');
    const limited=data.results.length>this.candidates,limitations=[];
    if(!data.complete)limitations.push('Partial catalog coverage; more sections may exist.');
    if(limited)limitations.push(`Only the first ${this.candidates} sections are available to this research request.`);
    return this.evidence(key,'catalog',task,{...data,results:data.results.slice(0,this.candidates)},data.retrieved_at,
      [catalogUrl({term,subject:task.subject,catalog:task.catalog})],{reused:result.reused,ageMs:result.ageMs},limitations,limitations.length?'partial':'ok');
  }
  async courseDetails(task:ResearchTask,budget:ResearchBudget,signal:AbortSignal):Promise<Evidence>{
    const term=semesterCode(task.semester),key=`details:${term}:${task.subject}:${task.catalog}`;
    const result=await this.read(key,'asu',this.evidenceTtl,budget,signal,()=>this.asu.get('/api/course_description',details,{term,subject:task.subject,catalog_nbr:task.catalog},signal));
    const raw=result.value.course;
    if(String(raw.SUBJECT??'').toUpperCase()!==task.subject||String(raw.CATALOGNBR??'').toUpperCase()!==task.catalog)throw new APIError('invalid_response');
    return this.evidence(key,'course_details',task,{description:result.value.description?.slice(0,9000),prerequisites:result.value.prerequisites?.slice(0,4000)},result.value.retrieved_at,
      [catalogUrl({term,subject:task.subject,catalog:task.catalog})],{reused:result.reused,ageMs:result.ageMs},['Prerequisite text does not establish student eligibility.']);
  }
  async syllabus(task:ResearchTask,budget:ResearchBudget,signal:AbortSignal,record:(e:Evidence)=>void):Promise<Evidence>{
    const catalog=await this.search(task,budget,signal);record(catalog);
    const rows=(catalog.data as CatalogResult).results;
    const matching=rows.filter(s=>(!task.classNumber||s.class_nbr===task.classNumber)&&(!task.professor||s.instructors.some(i=>normalizedName(i.name)===normalizedName(task.professor!))));
    if(task.classNumber&&!matching.length)throw new ResearchLimit('That section/instructor identity was not found in the requested course and semester.');
    if(!matching.length&&rows.length&&task.professor)throw new ResearchLimit('The requested professor was not found among the returned course sections.');
    const chosen=matching[0],term=semesterCode(task.semester);
    if(!chosen)throw new ResearchLimit('No exact course offering was found; syllabus identity is unresolved.');
    const key=`syllabus:${term}:${chosen.class_nbr}:${task.professor??''}`;
    const result=await this.read(key,'asu',this.evidenceTtl,budget,signal,async()=>{
      try{
        const exact=await this.asu.get('/api/syllabus/text',exactSyllabus,{term,class_nbr:chosen.class_nbr,max_chars:String(SYLLABUS_EXTRACTION_LIMIT)},signal);
        if(exact.class_nbr!==chosen.class_nbr||exact.source_term!==term)throw new APIError('invalid_response');
        return {...exact,status:'ok' as const,requested_term:term,course:`${task.subject} ${task.catalog}`,historical:false,same_professor:null,search_complete:true,warning:null,instructors:chosen.instructors.map(i=>i.name)};
      }catch(error){
        // Only absence triggers the labeled broader search. Rate limits/timeouts are not absence.
        if(!(error instanceof APIError&&error.status===404))throw error;
        if(++budget.tools>budget.maxTools)throw new ResearchLimit('Research request limit reached before syllabus fallback.');
        return this.asu.get('/api/syllabus/lookup',fallbackSyllabus,{term,subject:task.subject,catalog_nbr:task.catalog,
          professor:task.professor??chosen.instructors[0]?.name??'',include_text:'true',max_chars:String(SYLLABUS_EXTRACTION_LIMIT),max_pages:'1',budget_seconds:'15'},signal);
      }
    });
    const data=result.value;
    if(data.requested_term!==term||data.course!==`${task.subject} ${task.catalog}`
      ||(data.status==='ok'&&(!data.source_term||!data.class_nbr))
      ||(data.source_term&&(semesterCode(data.source_term)!==data.source_term||data.source_term>term)))throw new APIError('invalid_response');
    const limitations=[];
    if(data.source_term&&data.source_term!==term)limitations.push(`Historical syllabus from ${semesterName(data.source_term)}; current grading/topics may differ.`);
    if(data.class_nbr!==chosen.class_nbr)limitations.push(`Fallback syllabus is from section ${data.class_nbr??'unknown'}, not requested section ${chosen.class_nbr}.`);
    const expectedInstructor=task.professor??chosen.instructors[0]?.name;
    const sameInstructor=expectedInstructor?Boolean(data.instructors?.some(n=>normalizedName(n)===normalizedName(expectedInstructor))):null;
    if(sameInstructor===false)limitations.push('Fallback syllabus instructor does not match the requested catalog instructor.');
    if(data.warning)limitations.push(data.warning);
    if(!data.search_complete)limitations.push('Syllabus discovery was incomplete.');
    if(data.truncated)limitations.push('Ray’s extracted text reached its character limit; the original syllabus document is unchanged.');
    const unavailable=data.status!=='ok'||!data.text?.trim()||(data.ocr_required||data.extraction_status==='ocr_required');
    if(unavailable)limitations.push((data.ocr_required||data.extraction_status==='ocr_required')?'OCR is required; syllabus text cannot be analyzed.':'No usable syllabus text was retrieved.');
    const sourceTerm=data.source_term??term,sourceId=data.class_nbr??chosen.class_nbr;
    let direct=data.download_url;
    if(data.status==='ok'&&(result.reused||!direct)){
      try{
        const link=await this.read(`document-url:${sourceTerm}:${sourceId}:${Date.now()}`,'asu',0,budget,signal,()=>this.asu.get('/api/syllabus_url',z.object({download_url:documentUrl}),{term:sourceTerm,class_nbr:sourceId,redirect:'false'},signal));
        direct=link.value.download_url;
      }catch{direct=undefined;limitations.push('The direct syllabus link could not be refreshed.');}
    }
    return this.evidence(key,'syllabus',task,{...data,extractionLimit:SYLLABUS_EXTRACTION_LIMIT,same_professor:sameInstructor,requestedSemester:semesterName(term),sourceSemester:semesterName(sourceTerm)},data.retrieved_at,[direct??(data.status==='ok'?this.asu.endpoint('/api/syllabus/document',{class_nbr:sourceId,term:sourceTerm}):catalogUrl({term:sourceTerm,subject:task.subject,catalog:task.catalog}))],
      {reused:result.reused,ageMs:result.ageMs},limitations,unavailable?'unavailable':limitations.length?'partial':'ok');
  }
  async findProfessor(task:ResearchTask,budget:ResearchBudget,signal:AbortSignal,record:(e:Evidence)=>void):Promise<Evidence>{
    let names:string[]=[];
    if(task.subject&&task.catalog&&task.semester){
      const catalog=await this.search(task,budget,signal);record(catalog);
      names=[...new Set((catalog.data as CatalogResult).results.flatMap(s=>s.instructors.map(i=>i.name.trim())).filter(Boolean))];
    }
    const name=task.professor??(names.length===1?names[0]:undefined);
    if(!name||(task.subject&&task.catalog&&!names.some(n=>normalizedName(n)===normalizedName(name))))throw new ResearchLimit(`Choose an instructor listed for this course: ${names.join(', ')||'none found'}.`);
    const key=`professor:15723:${normalizedName(name)}:${task.subject}`;
    const result=await this.read(key,'rmp',this.evidenceTtl,budget,signal,async()=>{
      const foundRows=new Map<string,z.infer<typeof professor>>();
      let cursor='',complete=false,retrieved='';
      const seen=new Set<string>();
      for(let page=0;page<3;page++){
        if(seen.has(cursor))break;seen.add(cursor);
        if(page&&++budget.tools>budget.maxTools)throw new ResearchLimit('Research request limit reached during professor identity search.');
        const found=await this.rmp.get('/api/professors',professors,{school_id:'15723',q:name,limit:'100',cursor,fallback:'false'},signal);
        if(found.didFallback)throw new APIError('invalid_response');
        retrieved=found.retrieved_at;
        for(const row of found.professors)foundRows.set(row.id,row);
        if(!found.pageInfo.hasNextPage){complete=true;break;}
        if(!found.pageInfo.endCursor)break;
        cursor=found.pageInfo.endCursor;
      }
      const candidates=[...foundRows.values()].filter(p=>normalizedName(`${p.firstName} ${p.lastName}`)===normalizedName(name));
      if(candidates.length!==1||!complete)return {status:'ambiguous' as const,reason:!complete?'search_incomplete':candidates.length===0?'no_exact_match':'duplicate_exact_matches',candidates,hasMore:!complete,retrieved_at:retrieved};
      if(++budget.tools>budget.maxTools)throw new ResearchLimit('Research request limit reached before professor identity confirmation.');
      const selected=await this.rmp.get(`/api/professors/${encodeURIComponent(candidates[0]!.id)}`,professor,{},signal);
      const school=selected.school?.id;
      const correctSchool=school==='15723'||school==='U2Nob29sLTE1NzIz';
      const computerSubjects=['CSE','CS','CIS','IFT','SER'];
      const departmentKnown=Boolean(selected.department)&&(!task.subject?true:computerSubjects.includes(task.subject)?/computer|computing|software|information/i.test(selected.department!):false);
      if(selected.id!==candidates[0]!.id||selected.legacyId!==candidates[0]!.legacyId||Buffer.from(selected.id,'base64').toString()!==`Teacher-${selected.legacyId}`||normalizedName(`${selected.firstName} ${selected.lastName}`)!==normalizedName(name)||!correctSchool||!departmentKnown)
        return {status:'ambiguous' as const,reason:'school_or_department_mismatch',candidates:[selected],hasMore:false,retrieved_at:selected.retrieved_at??retrieved};
      return {status:'ok' as const,professor:selected,retrieved_at:selected.retrieved_at??retrieved};
    });
    const data=result.value;
    const urls=data.status==='ok'?[`https://www.ratemyprofessors.com/professor/${data.professor.legacyId}`]:[];
    return this.evidence(key,'professor_identity',task,data,data.retrieved_at,urls,{reused:result.reused,ageMs:result.ageMs},
      data.status==='ok'?['RMP ratings are student opinions; aggregate ratings may cover other courses.']:[data.reason==='no_exact_match'?'No exact full-name profile was returned by the ASU RMP search.':data.reason==='search_incomplete'?'The RMP name search is incomplete; identity remains unverified.':data.reason==='duplicate_exact_matches'?'Multiple exact-name profiles need disambiguation.':'The matching name did not pass school or department checks.'],data.status);
  }
  async reviewPage(task:ResearchTask,identity:Evidence,cursor:string,budget:ResearchBudget,signal:AbortSignal):Promise<Evidence>{
    const confirmed=identity.data as {status:string;professor?:z.infer<typeof professor>};
    if(confirmed.status!=='ok'||!confirmed.professor)throw new ResearchLimit('Professor identity must be confirmed before reading reviews.');
    const id=confirmed.professor.id,key=`reviews:${id}:${cursor}`;
    const result=await this.read(key,'rmp',this.evidenceTtl,budget,signal,()=>this.rmp.get(`/api/professors/${encodeURIComponent(id)}/reviews`,reviews,{limit:'100',cursor},signal));
    const data={...result.value,reviews:result.value.reviews.map(r=>({...r,comment:r.comment?.slice(0,1800),
      courseRelevance:Boolean(task.subject&&task.catalog)&&normalizeCourseLabel(r.class??'')===normalizeCourseLabel(`${task.subject}${task.catalog}`)?'exact_label':'other_or_unclear_label'}))};
    return this.evidence(key,'review_page',task,data,data.retrieved_at,[`https://www.ratemyprofessors.com/professor/${confirmed.professor.legacyId}`],
      {reused:result.reused,ageMs:result.ageMs},['Reviews are a paginated sample with original dates and course labels; other-course comments are general instructor context.',
        ...(data.pageInfo.hasNextPage?['Additional review pages exist.']:[])],data.pageInfo.hasNextPage?'partial':'ok');
  }
  async collectReviews(task:ResearchTask,budget:ResearchBudget,signal:AbortSignal,record:(e:Evidence)=>void,maxPages=20):Promise<Evidence>{
    const identity=await this.findProfessor(task,budget,signal,record);record(identity);
    if(identity.status!=='ok')return identity;
    const pages:Evidence[]=[],rows=new Map<string,Record<string,unknown>>();
    let cursor='',complete=false,problem='';
    const visited=new Set<string>();
    for(let page=0;page<maxPages;page++){
      if(visited.has(cursor)){problem='Review source repeated a page cursor.';break;}
      visited.add(cursor);
      try{
        const evidence=await this.reviewPage(task,identity,cursor,budget,signal);pages.push(evidence);
        const data=evidence.data as {reviews:Record<string,unknown>[];pageInfo:{hasNextPage:boolean;endCursor:string|null}};
        for(const row of data.reviews)rows.set(String(row.id),row);
        if(!data.pageInfo.hasNextPage){complete=true;break;}
        if(!data.pageInfo.endCursor){problem='Review pagination could not continue.';break;}
        cursor=data.pageInfo.endCursor;
      }catch(error){problem=safeResearchError(error);break;}
    }
    const all=[...rows.values()],specific=all.filter(r=>r.courseRelevance==='exact_label'),general=all.filter(r=>r.courseRelevance!=='exact_label');
    // Fetch the full bounded corpus, but pass a relevance-first, bounded excerpt to the writer.
    const selected=[...specific.slice(0,16),...general.slice(0,specific.length?3:12)].map(r=>({...r,comment:String(r.comment??'').slice(0,650)}));
    const data={professor:identity.data,reviews:selected,coverage:{pagesFetched:pages.length,reviewsRetrieved:all.length,courseSpecific:specific.length,
      general:general.length,complete,excerptsShown:selected.length,excerptsTruncated:selected.length<all.length}};
    return this.evidence(`review-corpus:${identity.id}:${task.subject}:${task.catalog}`,'review_corpus',task,data,pages.at(-1)?.retrievedAt??identity.retrievedAt,
      identity.sources,{reused:pages.length>0&&pages.every(p=>p.reused),ageMs:Math.max(0,...pages.map(p=>p.ageMs))},
      [...(!complete?['Review retrieval is partial'+(problem?`: ${problem}`:': page limit reached')+'.']:[])],pages.length?(complete?'ok':'partial'):'unavailable');
  }

}
