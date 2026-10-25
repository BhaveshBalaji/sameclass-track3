import type {PlanningSession} from '../domain/planning.js';
import type {Projection} from './types.js';

export function courseFamilies(values:string[]):{subject:string;prefix:string}[]{
  const result=new Map<string,{subject:string;prefix:string}>();
  for(const value of values)for(const match of value.matchAll(/\b([A-Z]{2,5})\s*([1-9])(?:xx|00\s*[-–]\s*([1-9])99)\b/gi)){
    if(match[3]&&match[3]!==match[2])continue;
    const family={subject:match[1]!.toUpperCase(),prefix:match[2]!};
    result.set(family.subject+family.prefix,family);
  }
  return [...result.values()];
}

/** Ground broad discovery and hard filters in each author's facts, independent of projection omissions. */
export function includeCourseFamilies(session:PlanningSession,projection:Projection):Projection{
  const queries:Projection['queries']=[];
  for(const person of Object.values(session.participants).filter(p=>p.active)){
    let projected=projection.participants.find(p=>p.userId===person.userId);
    if(!projected){projected={userId:person.userId,constraints:[]};projection.participants.push(projected);}
    for(const fact of Object.values(person.profile.facts)){
      if(!fact||fact.strength!=='hard')continue;
      const families=courseFamilies(fact.values);if(!families.length)continue;
      // A broad range must never be interpreted as a literal section/course code.
      projected.constraints=projected.constraints.filter(c=>c.factKey!==fact.field);
      projected.constraints.push({factKey:fact.field,kind:'course_family',understood:true,
        values:families.map(f=>`${f.subject} ${f.prefix}xx`),min:null,max:null,windows:[]});
      queries.push(...families.map(f=>({subject:f.subject,catalog:f.prefix,keyword:''})));
    }
  }
  projection.queries=[...new Map([...queries,...projection.queries].map(q=>[JSON.stringify(q),q])).values()].slice(0,4);
  return projection;
}
