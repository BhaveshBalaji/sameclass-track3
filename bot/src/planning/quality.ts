import type {Participant,PlanningSession} from '../domain/planning.js';
import type {Evidence} from '../research/types.js';
import type {Candidate} from './types.js';

/** Conservative topic explanation from an official description, without a model guess about workload. */
export function officialTopicReasons(person:Participant,candidate:Candidate):string[]{
  const description=candidate.research?.evidence.find(e=>e.kind==='course_details'&&e.status==='ok');
  const text=(description?.data as {description?:string}|undefined)?.description;if(!text)return [];
  const topics:[RegExp,RegExp][]=[[/\bAI\b|\bML\b|artificial intelligence|machine learning/i,/\bartificial intelligence\b|\bmachine learning\b|\bdeep learning\b|\bclassification\b|\bclustering\b/i],
    [/\bNLP\b|natural language/i,/\bnatural language(?: processing)?\b/i],[/database/i,/\bdatabases?\b/i]];
  const reasons:string[]=[];
  for(const fact of Object.values(person.profile.facts)){
    if(!fact||fact.strength!=='soft'||!/topic|interest|subject/.test(fact.field)||/avoid|dislike|exclude/.test(fact.field))continue;
    for(const value of fact.values){
      if(/\b(?:hate|avoid|dislike|not interested|except|not)\b/i.test(value))continue;
      for(const [preference,source]of topics){
        const quote=text.match(source)?.[0];
        if(preference.test(value)&&quote)reasons.push(`Official description includes “${quote}”, matching your ${value} interest`);
      }
    }
  }
  return [...new Set(reasons)];
}

export function reviewProfile(e:Evidence){
  const data=e.data as {status?:string;professor?:{status?:string;professor?:Record<string,unknown>}|Record<string,unknown>;coverage?:{courseSpecific?:number;complete?:boolean}};
  const identity=e.kind==='review_corpus'?data.professor as {status?:string;professor?:Record<string,unknown>}:data;
  const professor=identity?.status==='ok'?identity.professor as {avgRating?:number;avgDifficulty?:number;numRatings?:number}:undefined;
  return {professor,courseSpecific:data.coverage?.courseSpecific??0,complete:data.coverage?.complete};
}
export function qualitySignals(session:PlanningSession,candidate:Candidate){
  for(const fit of candidate.fits)if(officialTopicReasons(session.participants[fit.userId]!,candidate).length)fit.softScore+=2;
  const records=candidate.research?.evidence??[],corpora=records.filter(e=>e.kind==='review_corpus'&&reviewProfile(e).professor);
  const source=corpora.length?corpora:records.filter(e=>e.kind==='professor_identity'&&reviewProfile(e).professor);
  for(const record of source){
    const {professor:p,courseSpecific}=reviewProfile(record);if(!p)continue;
    const confidence=courseSpecific?1:0.35;
    for(const fit of candidate.fits){
      const soft=Object.values(session.participants[fit.userId]!.profile.facts).filter(f=>f?.strength==='soft').flatMap(f=>f!.values).join(' ');
      if(/easy|easier|simpl|lighter|light workload|low workload/i.test(soft)&&p.avgDifficulty!==undefined&&p.avgDifficulty>=4&&p.avgDifficulty<=5){
        fit.softScore-=(p.avgDifficulty-3)*3*confidence;
        fit.softEvidence.push(`Review tradeoff: professor difficulty ${p.avgDifficulty}/5 across courses${courseSpecific?'':'; course-specific difficulty unverified'}`);
      }
      if(/good.*(?:professor|reviews|ratings)|professor.*(?:reviews|ratings)|quality/i.test(soft)&&p.avgRating!==undefined&&p.avgRating>=0&&p.avgRating<=5){
        fit.softScore+=(p.avgRating-3)*confidence;
      }
    }
  }
}
