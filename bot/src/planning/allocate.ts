import type {PlanningSession} from '../domain/planning.js';
import {sectionsOverlap} from './matcher.js';
import type {Candidate,GroupSchedule,StudentSchedule} from './types.js';

export function requestedCourses(session:PlanningSession,userId:string){
  const value=session.participants[userId]?.profile.facts.course_count?.values.join(' ')??'';
  const words:Record<string,number>={one:1,two:2,three:3,four:4};
  const match=value.match(/\b(\d+|one|two|three|four)\b/i);
  return {count:match?Math.max(1,words[match[1]!.toLowerCase()]??Number(match[1])):1,known:Boolean(match)};
}
export function eligible(candidate:Candidate,userId:string){
  const fit=candidate.fits.find(f=>f.userId===userId);
  return Boolean(fit&&fit.status!=='conflict'&&fit.timeStatus==='checked'&&candidate.components.every(s=>s.open_seats!==0));
}
export function score(candidate:Candidate,userId:string){
  const fit=candidate.fits.find(f=>f.userId===userId)!;
  return fit.softScore+(candidate.research?.evidence.some(e=>e.kind==='syllabus'&&e.status!=='unavailable')?0.25:0)
    +(candidate.research?.evidence.some(e=>e.kind==='review_corpus'&&e.status!=='unavailable')?0.25:0);
}
/** Bounded beam search: fill each student's request, maximize shared enrollments, then prefer evidence-backed soft fit. */
export function allocate(session:PlanningSession,candidates:Candidate[]):GroupSchedule{
  let states=0,bounded=false;
  const options:StudentSchedule[][]=[];
  for(const person of Object.values(session.participants).filter(p=>p.active)){
    const request=requestedCourses(session,person.userId),target=Math.min(request.count,4);
    if(request.count>target)bounded=true;
    const valid=candidates.filter(c=>eligible(c,person.userId)).sort((a,b)=>score(b,person.userId)-score(a,person.userId));
    const schedules:Candidate[][]=[];let visits=0;
    function visit(index:number,chosen:Candidate[]){
      states++;if(++visits>4096){bounded=true;return;}
      schedules.push(chosen);
      if(chosen.length===target)return;
      for(let i=index;i<valid.length;i++){
        const next=valid[i]!;
        if(chosen.some(c=>c.section.subject===next.section.subject&&c.section.catalog_nbr===next.section.catalog_nbr))continue;
        if(chosen.some(c=>c.components.some(a=>next.components.some(b=>sectionsOverlap(a,b)))))continue;
        visit(i+1,[...chosen,next]);
      }
    }
    visit(0,[]);
    schedules.sort((a,b)=>b.length-a.length||b.reduce((n,c)=>n+score(c,person.userId),0)-a.reduce((n,c)=>n+score(c,person.userId),0));
    if(schedules.length>96)bounded=true;
    options.push(schedules.slice(0,96).map(candidates=>({userId:person.userId,requested:request.count,target,candidates,countKnown:request.known})));
  }
  function metrics(students:StudentSchedule[]){
    const ids=new Map<string,number>();
    for(const s of students)for(const c of s.candidates)ids.set(c.section.class_nbr,(ids.get(c.section.class_nbr)??0)+1);
    return [students.filter(s=>s.candidates.length===s.requested).length,students.reduce((n,s)=>n+s.candidates.length,0),
      [...ids.values()].reduce((n,k)=>n+k*(k-1)/2,0),students.reduce((n,s)=>n+s.candidates.reduce((m,c)=>m+score(c,s.userId),0),0)];
  }
  function compare(a:StudentSchedule[],b:StudentSchedule[]){const x=metrics(a),y=metrics(b);for(let i=0;i<x.length;i++){if(x[i]!==y[i])return y[i]!-x[i]!;}return JSON.stringify(a.map(s=>s.candidates.map(c=>c.section.class_nbr))).localeCompare(JSON.stringify(b.map(s=>s.candidates.map(c=>c.section.class_nbr))));}
  let beam:StudentSchedule[][]=[[]];
  for(const choices of options){
    const next=beam.flatMap(group=>choices.map(choice=>[...group,choice]));
    next.sort(compare);if(next.length>128)bounded=true;beam=next.slice(0,128);
  }
  const students=beam[0]??[];
  return {students,sharedPairs:metrics(students)[2]!,searchedStates:states,bounded};
}
