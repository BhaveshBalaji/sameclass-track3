import {semesterCode,semesterName} from '../domain/semester.js';
import type {ResearchContext} from './types.js';

export function knownScope(question:string,context:ResearchContext,activeTerm?:string){
  const coursePattern=/\b([a-z]{2,5})\s*-?\s*(\d{3}[a-z]?)\b/i;
  const termPattern=/\b(?:(?:spring|summer|fall|autumn)\s+20\d{2}|20\d{2}\s+(?:spring|summer|fall|autumn))\b/i;
  const recent=[...context.turns].reverse(),explicit=coursePattern.exec(question);
  const previous=recent.flatMap(t=>t.tasks).find(t=>t.subject&&t.catalog&&(!explicit||(t.subject===explicit[1]!.toUpperCase()&&t.catalog===explicit[2]!.toUpperCase())));
  const named=explicit??recent.map(t=>coursePattern.exec(t.question)||coursePattern.exec(t.answer)).find(Boolean);
  const subject=named?.[1]?.toUpperCase()??previous?.subject;
  const catalog=named?.[2]?.toUpperCase()??previous?.catalog;
  const value=termPattern.exec(question)?.[0]??previous?.semester
    ??recent.map(t=>termPattern.exec(t.question)?.[0]??termPattern.exec(t.answer)?.[0]).find(Boolean)??activeTerm;
  let semester:string|undefined;
  try{if(value)semester=semesterName(semesterCode(value));}catch{/* An invalid candidate is unknown, not an invitation to guess. */}
  return {subject,catalog,semester};
}
