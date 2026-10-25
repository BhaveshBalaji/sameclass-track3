import type {Participant,PlanningSession} from '../domain/planning.js';
import type {Candidate,Constraint,Fit,Projection,Section,TimeWindow} from './types.js';
import {courseFamilies} from './course-family.js';
import {isTimeFact} from './attendance.js';

const canonical=(s:string)=>s.replace(/[^a-z0-9]/gi,'').toUpperCase();
const campus=(s:string)=>({ASUONLINE:'ONLINE',DOWNTOWNPHOENIX:'DTPHX',DOWNTOWN:'DTPHX',POLYTECHNIC:'POLY'} as Record<string,string>)[canonical(s)]??canonical(s);
const minute=(s:string)=>{const [h,m]=s.split(':').map(Number);return h!*60+m!;};
function dateOverlap(meeting:Section['meeting_intervals'][number],window:TimeWindow):boolean|'unknown'{
  if(!window.startDate&&!window.endDate)return true;
  if(!meeting.start_date||!meeting.end_date||!/^\d{4}-\d{2}-\d{2}$/.test(meeting.start_date)||!/^\d{4}-\d{2}-\d{2}$/.test(meeting.end_date))return 'unknown';
  return !((window.endDate&&window.endDate<meeting.start_date)||(window.startDate&&window.startDate>meeting.end_date));
}
export function timeCheck(section:Section,windows:TimeWindow[]):{conflict:boolean;unknown:boolean}{
  let unknown=!section.meeting_intervals.length;
  for(const meeting of section.meeting_intervals){
    if(meeting.status!=='scheduled'||!meeting.start||!meeting.end||!meeting.days.length||meeting.days.some(d=>!['MON','TUE','WED','THU','FRI','SAT','SUN'].includes(d))||!/^([01]\d|2[0-3]):[0-5]\d$/.test(meeting.start)||!/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(meeting.end)||!Number.isFinite(minute(meeting.start))||!Number.isFinite(minute(meeting.end))||minute(meeting.start)>=minute(meeting.end)){unknown=true;continue;}
    for(const window of windows){
      if(window.timezone!==section.timezone||!Number.isFinite(minute(window.start))||!Number.isFinite(minute(window.end))||minute(window.start)>=minute(window.end)||(window.startDate&&window.endDate&&window.startDate>window.endDate)){unknown=true;continue;}
      if(!meeting.days.some(day=>window.days.includes(day as TimeWindow['days'][number])))continue;
      if(minute(meeting.start)>=minute(window.end)||minute(window.start)>=minute(meeting.end))continue;
      const overlap=dateOverlap(meeting,window);
      if(overlap===true)return {conflict:true,unknown};
      if(overlap==='unknown')unknown=true;
    }
  }
  return {conflict:false,unknown};
}
function allowedCheck(section:Section,windows:TimeWindow[]):{conflict:boolean;unknown:boolean}{
  if(!section.meeting_intervals.length)return {conflict:false,unknown:true};
  let unknown=false;
  for(const meeting of section.meeting_intervals){
    if(meeting.status!=='scheduled'||!meeting.start||!meeting.end||!meeting.days.length){unknown=true;continue;}
    for(const day of meeting.days){
      const same=windows.filter(w=>w.days.includes(day as TimeWindow['days'][number])&&w.timezone===section.timezone);
      if(!same.length){if(windows.some(w=>w.timezone!==section.timezone)){unknown=true;continue;}return {conflict:true,unknown};}
      if(!same.some(w=>minute(meeting.start!)>=minute(w.start)&&minute(meeting.end!)<=minute(w.end)))return {conflict:true,unknown};
      if(same.some(w=>w.startDate||w.endDate))unknown=true;
    }
  }
  return {conflict:false,unknown};
}
export function sectionsOverlap(a:Section,b:Section){
  const windows=a.meeting_intervals.filter(m=>m.status==='scheduled'&&m.start&&m.end&&m.days.length).map(m=>({days:m.days as TimeWindow['days'],start:m.start!,end:m.end!,startDate:m.start_date,endDate:m.end_date,timezone:a.timezone}));
  const result=timeCheck(b,windows);return !windows.length||result.conflict||result.unknown;
}
function bundle(section:Section,all:Section[]){
  const proof=section.linked_components;
  if(proof?.status!=='verified')return {components:[section],verified:false,notes:['Required lab/recitation compatibility unchecked.']};
  const needed=proof.required_class_numbers.map(id=>all.find(s=>s.class_nbr===id&&s.term===section.term&&s.course_id===section.course_id));
  if(needed.some(s=>!s))return {components:[section,...needed.filter((s):s is Section=>Boolean(s))],verified:false,notes:['A required lab/recitation offering was not retrieved.']};
  const components=[...new Map([section,...needed as Section[]].map(s=>[s.class_nbr,s])).values()];
  const notes:string[]=[];
  // A source-verified bundle still cannot be called usable if its own meetings clash.
  for(let i=0;i<components.length;i++)for(let j=i+1;j<components.length;j++){
    const windows:TimeWindow[]=components[i]!.meeting_intervals.filter(m=>m.status==='scheduled'&&m.start&&m.end&&m.days.length).map(m=>({days:m.days as TimeWindow['days'],start:m.start!,end:m.end!,startDate:m.start_date,endDate:m.end_date,timezone:components[i]!.timezone}));
    const checked=timeCheck(components[j]!,windows);
    if(checked.conflict)notes.push('Required components have overlapping meetings.');
    else if(checked.unknown)notes.push('Required component meeting compatibility is unresolved.');
  }
  return {components,verified:!notes.length,notes};
}
function fit(person:Participant,constraints:Constraint[],section:Section,components:Section[]):Fit{
  const conflicts:string[]=[],unchecked:string[]=[],preferences:string[]=[],softEvidence:string[]=[];
  const facts=Object.entries(person.profile.facts).filter((entry):entry is [string,NonNullable<typeof entry[1]>]=>Boolean(entry[1]));
  const handled=new Set<string>();let hasTime=false,hasCourse=false,hasCampus=false,hasCredits=false,softScore=0;
  for(const c of constraints){
    const fact=person.profile.facts[c.factKey];if(!fact)continue;
    handled.add(c.factKey);
    if(c.factKey==='course_count')continue;
    if(fact.strength==='soft'){
      const label=fact.values.join('; ');preferences.push(`${c.factKey.replace(/_/g,' ')}: ${label}`);
      if(c.understood&&c.kind==='campus'&&c.values.some(v=>campus(v)===campus(section.campus??''))){softScore++;softEvidence.push('Matches the preferred campus');}
      if(c.understood&&['unavailable','available'].includes(c.kind)&&c.windows.length){
        const checks=components.map(s=>c.kind==='available'?allowedCheck(s,c.windows):timeCheck(s,c.windows));
        if(checks.every(c=>!c.conflict&&!c.unknown)){softScore+=2;softEvidence.push(`Time preference: ${label}`);}
        else if(checks.some(c=>c.conflict)){
          softScore-=2;
          const lunch=/lunch/i.test(label)&&c.windows.some(w=>w.start==='12:00'&&w.end==='14:00'&&components.some(s=>timeCheck(s,[w]).conflict));
          softEvidence.push(lunch?'Time tradeoff: overlaps the preferred 12–2 PM lunch break':`Time tradeoff: ${label}`);
        }
      }
      continue;
    }
    if(!c.understood){unchecked.push(`${c.factKey.replace(/_/g,' ')} needs clarification`);continue;}
    if(c.kind==='unrestricted_time'&&fact.strength==='unrestricted'){
      if(/time|weekday|schedule|availability|any day/i.test(fact.values.join(' ')))hasTime=true;
      else unchecked.push('Which dimension is unrestricted is unclear');
    }else if(c.kind==='campus'&&fact.strength==='unrestricted')hasCampus=true;
    else if(c.kind==='allowed_courses'&&fact.strength==='unrestricted')hasCourse=true;
    else if(c.kind==='course_credits'&&fact.strength==='unrestricted')hasCredits=true;
    else if(['unavailable','available'].includes(c.kind)&&fact.strength==='hard'){
      hasTime=true;
      if(!c.windows.length){unchecked.push('Availability could not be interpreted');continue;}
      for(const s of components){const result=c.kind==='available'?allowedCheck(s,c.windows):timeCheck(s,c.windows);if(result.conflict)conflicts.push(`Section ${s.class_nbr} ${c.kind==='available'?'is outside stated availability':'overlaps unavailable time'}`);else if(result.unknown)unchecked.push(`Section ${s.class_nbr} has unresolved meeting/timezone/date information`);}
    }else if(c.kind==='course_family'&&fact.strength==='hard'){
      hasCourse=true;
      const families=courseFamilies(c.values);
      if(!families.length)unchecked.push('Course family could not be interpreted');
      else if(!families.some(f=>section.subject.toUpperCase()===f.subject&&new RegExp(`^${f.prefix}\\d{2}[A-Z]?$`,'i').test(section.catalog_nbr)))conflicts.push(`Outside stated course family: ${c.values.join(', ')}`);
    }else if(c.kind==='allowed_courses'&&fact.strength==='hard'){
      hasCourse=true;if(!c.values.length)unchecked.push('Approved course list is unknown');
      else if(!c.values.some(v=>canonical(v)===canonical(section.subject+section.catalog_nbr)))conflicts.push('Outside stated approved course list');
    }else if(c.kind==='campus'&&fact.strength==='hard'){
      hasCampus=true;
      if(!section.campus||!c.values.length)unchecked.push('Campus is unknown');
      else if(!c.values.some(v=>campus(v)===campus(section.campus!)))conflicts.push(`Campus ${section.campus} does not match`);
      for(const linked of components.slice(1))if(!linked.campus||campus(linked.campus)!==campus(section.campus??''))unchecked.push(`Campus for component ${linked.class_nbr} needs checking`);
    }else if(c.kind==='course_credits'&&fact.strength==='hard'){
      hasCredits=true;const lo=Number(section.units_min),hi=Number(section.units_max??section.units_min);
      if(section.units_min==null||!Number.isFinite(lo)||!Number.isFinite(hi)||lo!==hi)unchecked.push('Fixed course credits are unknown');
      else if((c.min!==null&&lo<c.min)||(c.max!==null&&hi>c.max))conflicts.push(`Course carries ${lo} credits, outside the requested range`);
    }else if(c.kind==='semester_credits')unchecked.push('Full-semester credit total is not computed');
    else if(c.kind==='course_count'){
      // Course count is enforced by the group schedule allocator.
    }else if(fact.strength==='hard')unchecked.push(`${c.factKey.replace(/_/g,' ')} has not been verified`);
  }
  for(const [key,fact]of facts)if(!handled.has(key)&&key!=='course_count'){
    if(fact.strength==='hard')unchecked.push(`${key.replace(/_/g,' ')} has not been checked`);
    else if(fact.strength==='soft')preferences.push(`${key.replace(/_/g,' ')}: ${fact.values.join('; ')}`);
  }
  if(!facts.length)unchecked.push('Preferences not shared yet');
  else{
    if(!hasTime)unchecked.push('Availability is unknown');if(!hasCourse)unchecked.push('Approved-course/requirement fit is unknown');
    if(!hasCampus)unchecked.push('Campus preference is unknown');if(!hasCredits)unchecked.push('Per-course credit requirement is unknown');
  }
  // Unrestricted attendance does not establish that the source actually publishes the meeting schedule.
  if(components.some(s=>!s.meeting_intervals.length||s.meeting_intervals.some(m=>m.status==='unknown'||!m.start||!m.end||!m.days.length)))unchecked.push('Some meeting times are unknown');
  const unresolvedHardTime=facts.some(([key,f])=>f.strength==='hard'&&isTimeFact(f)&&!constraints.some(c=>c.factKey===key&&c.understood&&['unavailable','available','unrestricted_time'].includes(c.kind)));
  const unknownTime=!hasTime||unresolvedHardTime||unchecked.some(n=>/meeting|timezone|[Aa]vailability/.test(n));
  return {timeStatus:conflicts.some(n=>/time|availability/.test(n))?'conflict':unknownTime?'unknown':'checked',userId:person.userId,name:person.name,status:conflicts.length?'conflict':unchecked.length?'unknown':'pass',conflicts:[...new Set(conflicts)],unchecked:[...new Set(unchecked)],preferences,softEvidence,softScore};
}
export function matchCandidates(session:PlanningSession,projection:Projection,sections:Section[]):Candidate[]{
  const people=Object.values(session.participants).filter(p=>p.active),known=people.filter(p=>Object.keys(p.profile.facts).length>0);
  return sections.filter(s=>!['LAB','REC','DIS'].includes((s.component??'').toUpperCase())).map(section=>{
    const linked=bundle(section,sections);
    const fits=people.map(person=>fit(person,projection.participants.find(p=>p.userId===person.userId)?.constraints??[],section,linked.components));
    if(linked.notes.some(n=>n.includes('overlapping')))for(const f of fits){f.conflicts.push('Required components overlap one another');f.status='conflict';}
    return {section,components:linked.components,bundleVerified:linked.verified,componentNotes:linked.notes,fits,
      covered:fits.filter(f=>f.status==='pass').length,known:known.length,
      shared:known.length>0&&known.every(p=>fits.find(f=>f.userId===p.userId)!.status!=='conflict')};
  }).sort((a,b)=>Number(b.shared)-Number(a.shared)||b.covered-a.covered||a.fits.filter(f=>f.status==='conflict').length-b.fits.filter(f=>f.status==='conflict').length
    ||b.fits.reduce((n,f)=>n+f.softScore,0)-a.fits.reduce((n,f)=>n+f.softScore,0)||a.section.class_nbr.localeCompare(b.section.class_nbr));
}
