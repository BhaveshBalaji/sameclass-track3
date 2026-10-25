import {END,START,StateGraph,StateSchema} from '@langchain/langgraph';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import type {PlanningSession} from '../domain/planning.js';
import {clean} from '../domain/planning.js';
import {semesterName} from '../domain/semester.js';
import type {CourseResearch} from '../application/catalog.js';
import {matchCandidates} from './matcher.js';
import type {Candidate,GroupPlanner,PlanningCatalog,PlanningProjection,Projection,Recommendation,Section,SoftFitAssessor,PlanningQuery} from './types.js';

export function isGroupRequest(text:string){return /\b(?:together|for (?:all of us|our group)|shared (?:classes|courses|options)|our (?:schedules|requirements)|group plan|plan (?:classes|courses) for us)\b/i.test(text);}
export class GroupPlanningEngine implements GroupPlanner{
  constructor(private projector:PlanningProjection,private catalog:PlanningCatalog,private research?:CourseResearch,
    private limits={candidates:12,shortlist:2,timeoutMs:90000},private softFit?:SoftFitAssessor){}
  async recommend(session:PlanningSession,question:string,parentSignal:AbortSignal):Promise<Recommendation>{
    const signal=AbortSignal.any([parentSignal,AbortSignal.timeout(this.limits.timeoutMs)]);
    let projection:Projection={queries:[],participants:[]},sections:Section[]=[],ranked:Candidate[]=[],notes:string[]=[],sources:string[]=[],evidence:{candidate:Candidate;text:string}[]=[];
    const graph=new StateGraph(new StateSchema({requestId:z.string(),status:z.string()}))
      .addNode('interpret',async()=>{signal.throwIfAborted();projection=await this.projector.project(session,question,signal);return {status:'interpreted'};})
      .addNode('catalog',async()=>{
        const campusFacts=projection.participants.flatMap(p=>p.constraints.filter(c=>c.kind==='campus'&&c.understood));
        const online=campusFacts.some(c=>c.values.some(v=>/online/i.test(v)));
        const allOnline=campusFacts.length>0&&campusFacts.every(c=>c.values.length>0&&c.values.every(v=>/online/i.test(v)));
        const deliveries:('A'|'O')[]=online?(allOnline?['O']:['A','O']):['A'];
        const queries:PlanningQuery[]=projection.queries.flatMap(q=>deliveries.map(delivery=>({term:session.term,subject:q.subject||undefined,catalog:q.catalog||undefined,keyword:q.keyword||undefined,delivery})));
        if(queries.length>4)notes.push('Search is bounded across courses/programs; additional matches may exist.');
        const results=await Promise.allSettled(queries.slice(0,4).map(q=>this.catalog.search(q,signal)));
        for(const result of results){
          if(result.status==='rejected'){notes.push('One catalog lookup failed; other results are retained.');continue;}
          if(!result.value.complete)notes.push('Catalog coverage is partial.');
          sections.push(...result.value.results);
        }
        sections=[...new Map(sections.map(s=>[`${s.term}:${s.class_nbr}`,s])).values()];
        // Preserve components needed to check shortlisted lectures, even after limiting the number of primary candidates.
        const groups=new Map<string,Section[]>();
        for(const s of sections.filter(s=>!['LAB','REC','DIS'].includes((s.component??'').toUpperCase()))){const key=`${s.subject}:${s.catalog_nbr}:${s.campus}`;groups.set(key,[...(groups.get(key)??[]),s]);}
        const primary:Section[]=[];
        while(primary.length<this.limits.candidates&&[...groups.values()].some(g=>g.length))for(const group of groups.values()){
          const s=group.shift();if(s&&primary.length<this.limits.candidates)primary.push(s);
        }
        const ids=new Set(primary.flatMap(s=>s.linked_components?.required_class_numbers??[]));
        if(primary.length<sections.filter(s=>!['LAB','REC','DIS'].includes((s.component??'').toUpperCase())).length)notes.push('Candidate search was bounded; more options may exist.');
        sections=[...primary,...sections.filter(s=>ids.has(s.class_nbr)&&!primary.some(p=>p.class_nbr===s.class_nbr))];
        return {status:'retrieved'};
      })
      .addNode('match',()=>{signal.throwIfAborted();ranked=matchCandidates(session,projection,sections);return {status:'matched'};})
      .addNode('research',async()=>{
        if(!this.research)return {status:'matched_without_research'};
        const shortlist=ranked.filter(c=>c.fits.some(f=>Object.keys(session.participants[f.userId]!.profile.facts).length>0&&f.status!=='conflict')).slice(0,this.limits.shortlist);
        const jobs=await Promise.allSettled(shortlist.map(async candidate=>{
          const s=candidate.section,prof=s.instructors.length===1?` with ${s.instructors[0]!.name}`:'';
          const interests=[...new Set(candidate.fits.flatMap(f=>f.preferences))].join('; ').slice(0,1200);
          const text=await this.research!.answer(`For ${s.subject} ${s.catalog_nbr} in ${semesterName(session.term)}, section ${s.class_nbr}${prof}, briefly research syllabus assessment/workload and course-specific professor reviews relevant to these preferences: ${interests||'no soft priorities supplied'}. Label historical evidence. Do not claim schedule compatibility.`,session.term,{turns:[],signal,offeringScope:{subject:s.subject,catalog:s.catalog_nbr,semester:semesterName(session.term),sectionId:s.class_nbr,instructors:s.instructors.map(i=>i.name),delivery:/online/i.test(s.campus??'')?'O':'A'}});
          return {candidate,text};
        }));
        signal.throwIfAborted();
        evidence=jobs.filter((r):r is PromiseFulfilledResult<{candidate:Candidate;text:string}>=>r.status==='fulfilled').map(r=>r.value);
        if(this.softFit){try{await this.softFit.assess(session,evidence,signal);}catch{notes.push('Some soft preferences lack a reliable evidence assessment.');}}
        ranked.sort((a,b)=>Number(b.shared)-Number(a.shared)||b.covered-a.covered||a.fits.filter(f=>f.status==='conflict').length-b.fits.filter(f=>f.status==='conflict').length
          ||b.fits.reduce((n,f)=>n+f.softScore,0)-a.fits.reduce((n,f)=>n+f.softScore,0));
        if(jobs.some(r=>r.status==='rejected'))notes.push('Some optional syllabus/review research failed; constraint checks are retained.');
        return {status:'researched'};
      }).addEdge(START,'interpret').addEdge('interpret','catalog').addEdge('catalog','match').addEdge('match','research').addEdge('research',END).compile();
    await graph.invoke({requestId:randomUUID(),status:'started'});signal.throwIfAborted();
    if(!projection.queries.length)return {text:'Which courses or subject interests should I consider for the group? Each student can share an approved list or elective requirement.',sectionIds:[]};
    if(!ranked.length)return {text:'I found no usable section listings in this bounded search. '+notes.join(' ')+' Share another course or broaden the search; your requirements are unchanged.',sectionIds:[]};
    const known=Object.values(session.participants).filter(p=>p.active&&Object.keys(p.profile.facts).length).length;
    const shared=ranked.filter(c=>c.shared),chosen=shared.slice(0,3);
    let text=`**Group options · ${semesterName(session.term)}**\n`;
    if(!known)text+='No participant requirements are known yet. These are preliminary catalog options, not verified fits.\n';
    if(!shared.length)text+='No single returned option avoids all known conflicts. I have kept everyone’s hard constraints.\n';
    else text+='These are single-course options, not a complete semester schedule.\n';
    function show(candidate:Candidate,label:string){
      const s=candidate.section,unknown=candidate.fits.some(f=>f.status==='unknown')||!candidate.bundleVerified;
      const heading=s.open_seats===0?'No open seats observed':unknown?'Preliminary — checks incomplete':'Matches the stated constraints';
      const meetings=s.meeting_intervals.filter(m=>m.status==='scheduled'&&m.start&&m.end).map(m=>`${m.days.join('/')} ${m.start}–${m.end}`).join('; ')||'meeting times unknown';
      return `\n**${label}: ${s.subject} ${s.catalog_nbr} · section ${s.class_nbr}**\n${heading}. ${clean(s.instructors.map(i=>i.name).join(', ')||'Instructor not listed')}; ${meetings} (${clean(s.timezone)}). ${s.open_seats===null?'Seats unknown':`${s.open_seats} open seats observed`}.\n`
        +candidate.fits.map(f=>`• **${clean(f.name)}:** ${f.status==='conflict'?clean(f.conflicts.join('; ')):f.status==='pass'?'Stated hard constraints checked':`No known conflict; ${clean(f.unchecked.slice(0,3).join('; '))}`}${f.softEvidence.length?`; soft fit: ${clean(f.softEvidence.slice(0,2).join('; '))}`:f.preferences.length?`; priorities still to assess: ${clean(f.preferences.slice(0,2).join('; '))}`:''}`).join('\n')
        +(candidate.componentNotes.length?'\n'+candidate.componentNotes.join(' '):'')
        +`\n[Class Link](${s.class_url})\n`;
    }
    chosen.forEach((c,index)=>{const verifiedBackup=index>0&&c.bundleVerified&&c.fits.every(f=>f.status==='pass')&&c.components.every(s=>(s.open_seats??0)>0);text+=show(c,verifiedBackup?'Backup':`Option ${index+1}`);sources.push(c.section.class_nbr);});
    // Individual alternatives are chosen on their own fit, not by silently relaxing the group constraints.
    for(const person of Object.values(session.participants).filter(p=>p.active&&Object.keys(p.profile.facts).length)){
      if(chosen.some(c=>c.fits.find(f=>f.userId===person.userId)?.status==='pass'))continue;
      const alternative=ranked.find(c=>c.fits.find(f=>f.userId===person.userId)?.status==='pass')??ranked.find(c=>c.fits.find(f=>f.userId===person.userId)?.status==='unknown');
      if(alternative&&!chosen.includes(alternative)){
        const s=alternative.section;
        const own=alternative.fits.find(f=>f.userId===person.userId)!;
        text+=`\n**${clean(person.name)}’s alternative:** ${s.subject} ${s.catalog_nbr}, section ${s.class_nbr}${own.status!=='pass'?` — preliminary: ${clean(own.unchecked.slice(0,2).join('; '))}`:alternative.bundleVerified?' — stated hard constraints checked':' — lab/recitation compatibility unchecked'}. [Class Link](${s.class_url})\n`;
        sources.push(s.class_nbr);
      }else if(!shared.length){
        const blocked=ranked.flatMap(c=>c.fits.filter(f=>f.userId===person.userId&&f.status==='conflict').flatMap(f=>f.conflicts));
        text+=`\n**${clean(person.name)}:** ${blocked.length?clean([...new Set(blocked)].slice(0,2).join('; ')):'Not enough known requirements to verify an alternative'}.\n`;
      }
    }
    for(const item of evidence){
      const s=item.candidate.section;
      text+=`\n**Research · ${s.subject} ${s.catalog_nbr}, section ${s.class_nbr}**\n${item.text}\n`;
    }
    const silent=Object.values(session.participants).filter(p=>p.active&&!Object.keys(p.profile.facts).length);
    if(silent.length)text+=`\n**Coverage:** ${known} participant(s) supplied requirements; ${silent.map(p=>clean(p.name)).join(', ')} ${silent.length===1?'still has':'still have'} unknown preferences. Their silence is not treated as flexibility.\n`;
    if(notes.length)text+='\n'+[...new Set(notes)].join(' ')+'\n';
    text+='\nStudent-approved lists are unverified claims. Degree/prerequisite eligibility and complete-semester totals are not verified.';
    return {text,sectionIds:[...new Set(sources)]};
  }
}
