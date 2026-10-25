import type {Fact,PlanningSession} from '../domain/planning.js';
import type {Projection,TimeWindow} from './types.js';

const weekdays:TimeWindow['days']=['MON','TUE','WED','THU','FRI'];
const allDays:TimeWindow['days']=[...weekdays,'SAT','SUN'];
const dayNames:Record<string,TimeWindow['days'][number]>={mon:'MON',tue:'TUE',wed:'WED',thu:'THU',fri:'FRI',sat:'SAT',sun:'SUN'};
function clock(hour:string,minutes:string|undefined,meridiem:string|undefined):string|undefined{
  let h=Number(hour),m=Number(minutes??0);if(m>59||h>24)return;
  if(meridiem){if(h<1||h>12)return;h=h%12+(/p/i.test(meridiem)?12:0);}
  else if(h<8&&h>0&&!minutes)return; // Ambiguous 'before 5' needs interpretation, not a guess.
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
export function beforeWindow(text:string):TimeWindow|undefined{
  const match=text.match(/\bbefore\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);if(!match)return;
  const end=clock(match[1]!,match[2],match[3]);if(!end||end==='00:00')return;
  const found=[...text.matchAll(/\b(mon|tue|wed|thu|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?s?\b/gi)].map(m=>dayNames[m[1]!.toLowerCase()]!);
  const days=found.length?found:/weekday/i.test(text)?weekdays:allDays;
  return {days:[...new Set(days)],start:'00:00',end,startDate:null,endDate:null,timezone:'America/Phoenix'};
}
export function blockedWindows(values:string[]):TimeWindow[]|undefined{
  const windows:TimeWindow[]=[];
  for(const value of values.flatMap(v=>v.split(';'))){
    const range=[...value.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/gi)];
    const found=[...value.matchAll(/\b(mon|tue|wed|thu|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?s?\b/gi)].map(m=>dayNames[m[1]!.toLowerCase()]!);
    if(range.length!==1||!found.length)return;
    const m=range[0]!;
    const ampm=m[3]??(m[6]&&(Number(m[1])===12||Number(m[1])<Number(m[4])&&Number(m[4])!==12)?m[6]:m[6]?'am':undefined);
    const start=clock(m[1]!,m[2],ampm),end=clock(m[4]!,m[5],m[6]);
    if(!start||!end||start>=end)return;
    windows.push({days:[...new Set(found)],start,end,startDate:null,endDate:null,timezone:'America/Phoenix'});
  }
  return windows.length?windows:undefined;
}
/** Recover an explicit attendance statement from its original author-validated quote, including legacy soft fields. */
export function attendanceSession(session:PlanningSession):PlanningSession{
  const copy=structuredClone(session);
  for(const p of Object.values(copy.participants)){
    for(const fact of Object.values(p.profile.facts)){
      if(!fact)continue;
      const bounds=fact.values.map(beforeWindow).filter(Boolean);
      if(!bounds.length)continue;
      const source=fact.sources.map(s=>{
        const original=session.messages.find(m=>m.id===s.messageId&&m.authorId===p.userId&&!m.ignored);
        return original?{...s,quote:original.content.slice(0,500)}:s;
      }).findLast(s=>/\b(?:i am|i'm|im)\s+(?:only\s+)?available\b/i.test(s.quote)&&bounds.some(w=>w!.end===beforeWindow(s.quote)?.end));
      if(!source)continue;
      p.profile.facts.attendance_limit={field:'attendance_limit',strength:'hard',values:[source.quote],sources:[source]};
      break;
    }
  }
  return copy;
}
/** Normalize literal limits; unclear hard facts remain unchecked rather than disappearing. */
export function attendanceProjection(session:PlanningSession,projection:Projection):Projection{
  for(const p of Object.values(session.participants).filter(p=>p.active)){
    let target=projection.participants.find(c=>c.userId===p.userId);
    if(!target){target={userId:p.userId,constraints:[]};projection.participants.push(target);}
    for(const fact of Object.values(p.profile.facts)){
      if(!fact)continue;
      const windows=fact.values.map(beforeWindow);
      if(windows.length&&windows.every((w):w is TimeWindow=>Boolean(w))&&(/avail|time|attendance/.test(fact.field))){
        // A preferred time is a positive window; it must not be inverted or treated as unrestricted.
        target.constraints=target.constraints.filter(c=>c.factKey!==fact.field);
        target.constraints.push({factKey:fact.field,kind:'available',understood:true,values:fact.values,min:null,max:null,windows});
      }else if(fact.strength==='soft'&&isTimeFact(fact)){
        for(const value of fact.values.filter(v=>/lunch.*(?:free|break)|(?:free|break).*lunch/i.test(v))){
          const blocks=blockedWindows([value+' MON TUE WED THU FRI']);
          if(blocks&&!target.constraints.some(c=>c.factKey===fact.field&&c.windows.some(w=>w.start===blocks[0]!.start&&w.end===blocks[0]!.end)))
            target.constraints.push({factKey:fact.field,kind:'unavailable',understood:true,values:[value],min:null,max:null,windows:blocks});
        }
      }else if(fact.strength==='hard'&&isTimeFact(fact)){
        const negative=/unavail|work|busy|blocked/.test(fact.field)||/\b(?:cannot|unavailable|not available|busy|work)\b/i.test(fact.values.join(' '));
        const blocked=negative?blockedWindows(fact.values):undefined;
        if(blocked){
          target.constraints=target.constraints.filter(c=>c.factKey!==fact.field);
          target.constraints.push({factKey:fact.field,kind:'unavailable',understood:true,values:fact.values,min:null,max:null,windows:blocked});
        }
      }
    }
  }
  return projection;
}
export function isTimeFact(fact:Fact){return /avail|time|schedule|attendance|work_hours|work_schedule/.test(fact.field);}
