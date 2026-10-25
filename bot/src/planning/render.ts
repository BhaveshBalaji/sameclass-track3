import {clean,type PlanningSession} from '../domain/planning.js';
import {semesterName} from '../domain/semester.js';
import {reviewProfile,officialTopicReasons} from './quality.js';
import type {Evidence} from '../research/types.js';
import type {Candidate,GroupSchedule,Recommendation} from './types.js';

const brief=(s:string)=>{
  const text=s.replace(/https?:\/\/\S+/g,'').replace(/[\r\n\[\]]+/g,' ').replace(/\s+/g,' ').trim();
  return clean(text.length>160?text.slice(0,157).replace(/\s+\S*$/,'')+'…':text);
};
export function meetings(candidate:Candidate){
  const time=(s:string)=>{const [h,m]=s.split(':').map(Number);return `${h!%12||12}${m?':'+String(m).padStart(2,'0'):''} ${h!>=12?'PM':'AM'}`;};
  return candidate.components.flatMap(s=>s.meeting_intervals.filter(m=>m.status==='scheduled'&&m.start&&m.end).map(m=>`${m.days.map(d=>d.slice(0,1)+d.slice(1).toLowerCase()).join('/')} ${time(m.start!)}–${time(m.end!)}`)).join('; ')||'Meeting times unknown';
}
function syllabusLabel(e:Evidence){
  const d=e.data as Record<string,unknown>;
  const term=typeof d.sourceSemester==='string'?d.sourceSemester:typeof d.source_term==='string'?semesterName(d.source_term):'term unknown';
  return `Syllabus: ${term}${d.historical?' · historical':''}${d.same_professor===false?' · different instructor':''}`;
}
function reviewLabel(e:Evidence){
  const profile=reviewProfile(e),p=profile.professor,n=profile.courseSpecific;
  const number=(v:number|undefined)=>v!==undefined&&v>=0&&v<=5?v.toFixed(1):'?';
  return `Professor reviews: ${number(p?.avgRating)}/5 rating, ${number(p?.avgDifficulty)}/5 difficulty${p?.numRatings!==undefined?` (${p.numRatings} ratings across courses)`:''}; ${n} course-specific reviews${n?'':'; general instructor context only'}${profile.complete===false?' · partial':''}`;
}
export function renderPlan(session:PlanningSession,schedule:GroupSchedule,ranked:Candidate[],notes:string[]):Recommendation{
  const inlineMentions=Object.values(session.participants).filter(p=>p.active).map((p,i)=>({marker:`[[ray-member:${i}]]`,userId:p.userId}));
  let text=`**Your proposed class plan · ${semesterName(session.term)}**\n`;
  for(const s of schedule.students){
    const person=session.participants[s.userId]!,marker=inlineMentions.find(m=>m.userId===s.userId)!.marker;
    text+=`\n${marker} — **${s.candidates.length}/${s.requested} course${s.requested===1?'':'s'} suggested**${s.countKnown?'':' (course count unconfirmed)'}\n`;
    const priorities=Object.values(person.profile.facts).filter(f=>f?.strength==='soft').flatMap(f=>f!.values);
    if(priorities.length)text+=`• Your preferences: ${brief(priorities.join('; '))}.\n`;
    if(!s.candidates.length){
      const reasons=ranked.flatMap(c=>c.fits.filter(f=>f.userId===s.userId).flatMap(f=>f.conflicts));
      text+=reasons.length?`• No safe choice in this search: ${brief([...new Set(reasons)].slice(0,2).join('; '))}.\n`:'• No time-checked choice yet; availability or meeting information is incomplete.\n';
    }
    const unchecked=[...new Set(s.candidates.flatMap(c=>c.fits.find(f=>f.userId===s.userId)!.unchecked))].filter(n=>!/Campus preference|Per-course credit|Approved-course/.test(n));
    if(unchecked.length)text+=`• Unverified: ${brief(unchecked.slice(0,2).join('; '))}.\n`;
    for(const c of s.candidates){
      const own=c.fits.find(f=>f.userId===s.userId)!;
      text+=`• **${c.section.subject} ${c.section.catalog_nbr} · ${c.section.class_nbr}** — ${meetings(c)}\n`;
      const why=[...officialTopicReasons(person,c),...own.softEvidence.filter(n=>!n.startsWith('Time preference:')&&!n.startsWith('Time tradeoff:')&&!n.startsWith('Review tradeoff:')&&!n.startsWith('Evidence tradeoff:'))].slice(0,2);
      text+=`  Why: fits your known attendance limits${why.length?'; '+brief(why.join('; ')):''}.`;
      if(!why.length)text+=' Interest/workload fit is not yet established from analyzed evidence.';
      text+='\n';
      const tradeoffs=own.softEvidence.filter(n=>n.startsWith('Time tradeoff:')||n.startsWith('Review tradeoff:')||n.startsWith('Evidence tradeoff:'));
      for(const tradeoff of tradeoffs.slice(0,2))text+=`  Heads-up: ${brief(tradeoff)}\n`;
    }
    if(s.candidates.some(c=>c.fits.find(f=>f.userId===s.userId)!.softEvidence.some(n=>n.startsWith('Review tradeoff:'))))text+='• These fill schedule needs with workload tradeoffs; an easy option is not verified.\n';
    if(s.candidates.length<s.requested)text+=`• Still need ${s.requested-s.candidates.length} more; hard constraints were kept.\n`;
  }
  text+='\n**Overall recommendation**\n';
  const selected=[...new Map(schedule.students.flatMap(s=>s.candidates).map(c=>[c.section.class_nbr,c])).values()];
  const users=(c:Candidate)=>schedule.students.filter(s=>s.candidates.includes(c));
  const shared=selected.filter(c=>users(c).length>1).sort((a,b)=>users(b).length-users(a).length
    ||users(b).reduce((n,s)=>n+b.fits.find(f=>f.userId===s.userId)!.softScore,0)-users(a).reduce((n,s)=>n+a.fits.find(f=>f.userId===s.userId)!.softScore,0));
  if(shared.length){
    const best=shared[0]!,everyone=users(best).length===schedule.students.length;
    text+=`${everyone?'Best common course in this plan':'Best partial-group course in this plan'}${best.bundleVerified?'':' (preliminary)'}: **${best.section.subject} ${best.section.catalog_nbr} · ${best.section.class_nbr}**, for ${users(best).map(s=>clean(session.participants[s.userId]!.name)).join(' + ')}. `;
    text+=everyone?'It meets everyone’s known attendance limits. Preference matches, tradeoffs and unverified fit are listed for each student above.\n':'No course was selected for everyone; other students’ alternatives and gaps are listed above.\n';
    if(shared.length>1)text+=`Other shared options: ${shared.slice(1).map(c=>`${c.section.subject} ${c.section.catalog_nbr} (${users(c).map(s=>clean(session.participants[s.userId]!.name)).join(' + ')})`).join('; ')}.\n`;
  }else text+='No common section was selected in this bounded plan; individual alternatives are shown where possible.\n';
  selected.slice(0,6).forEach((c,index)=>{
    const s=c.section;
    text+=`\n**Option ${index+1}: ${s.subject} ${s.catalog_nbr} — ${brief(s.title)}**\n${brief(s.instructors.map(i=>i.name).join(', ')||'Instructor unknown')} · ${s.open_seats===null?'seats unknown':`${s.open_seats} seats observed`}\n`;
    const syllabus=c.research?.evidence.find(e=>e.kind==='syllabus'&&e.status!=='unavailable');
    let reviews=c.research?.evidence.filter(e=>e.kind==='review_corpus'&&e.status!=='unavailable')??[];
    if(!reviews.length)reviews=c.research?.evidence.filter(e=>e.kind==='professor_identity'&&reviewProfile(e).professor)??[];
    const links=[`[Schedule](${s.class_url})`];
    if(syllabus){text+=`${syllabusLabel(syllabus)}\n`;if(syllabus.sources[0])links.push(`[Syllabus](${syllabus.sources[0]})`);}
    else text+='Syllabus: usable text unavailable.\n';
    if(reviews.length)for(const review of reviews){text+=reviewLabel(review)+'\n';if(review.sources[0])links.push(`[Reviews](${review.sources[0]})`);}
    else text+='Professor reviews: identity/evidence unavailable.\n';
    for(const f of (c.findings??[]).slice(0,2)){
      const source=c.research?.evidence.find(e=>e.id===f.evidenceId);
      const qualifier=source?.kind==='syllabus'&&(source.data as {historical?:boolean}).historical?`Historical syllabus${(source.data as {same_professor?:boolean}).same_professor===false?' · different instructor':''}`:source?.kind==='review_corpus'?'Student reports':'Source';
      text+=`${f.category==='topics'?'Topics':f.caution?'Heads-up · '+qualifier:qualifier}: ${brief(f.note)}\n`;
    }
    if(!c.findings?.some(f=>f.category==='workload'||f.category==='grading'))text+='Workload/grading: not enough analyzed evidence to call this easy.\n';
    text+=links.join(' · ')+'\n';
  });
  if(selected.length>6)text+='Additional assigned sections: '+selected.slice(6).map(c=>`[${c.section.subject} ${c.section.catalog_nbr} · ${c.section.class_nbr}](${c.section.class_url})`).join(' · ')+'\n';
  text+='\n**Checks:** assigned classes respect known time limits and do not overlap with one another. ';
  if(selected.some(c=>!c.bundleVerified))text+='Required lab/recitation rules remain unchecked. ';
  text+='Degree/prerequisite eligibility is not verified; missing requirements remain unknown.';
  if(notes.some(n=>/lookup failed/.test(n)))text+=' A catalog lookup failed; other results were retained.';
  if(schedule.bounded||notes.length)text+=' Search/research was bounded; more options may exist.';
  if(selected.some(c=>c.research?.limitations.length))text+=' Some sources could not be retrieved.';
  const spoken={members:schedule.students.map(student=>({name:session.participants[student.userId]!.name,requested:student.requested,
    choices:student.candidates.map(c=>({course:`${c.section.subject} ${c.section.catalog_nbr}`,section:c.section.class_nbr,
      instructors:c.section.instructors.map(i=>i.name),meetings:meetings(c),
      reasons:c.fits.find(f=>f.userId===student.userId)!.softEvidence.slice(0,2),
      unchecked:[...c.fits.find(f=>f.userId===student.userId)!.unchecked,...(!c.bundleVerified?['Required lab/recitation rules unchecked']:[])]}))})),
    shared:shared.map(c=>({course:`${c.section.subject} ${c.section.catalog_nbr}`,names:schedule.students.filter(s=>s.candidates.includes(c)).map(s=>session.participants[s.userId]!.name),preliminary:!c.bundleVerified})),
    limitations:['Degree/prerequisite eligibility is not verified; missing requirements remain unknown.',...notes]};
  return {text,sectionIds:selected.map(c=>c.section.class_nbr),inlineMentions,assignments:schedule.students.map(s=>({userId:s.userId,requested:s.requested,sectionIds:s.candidates.map(c=>c.section.class_nbr)})),spoken};
}
