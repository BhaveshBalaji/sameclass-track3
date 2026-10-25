import type {PlanningSession} from '../domain/planning.js';
import type {Section} from './types.js';

/** Title relevance chooses what to research; it never proves workload, eligibility or constraint fit. */
export function discoveryRelevance(session:PlanningSession,section:Section):number{
  let score=0;
  for(const person of Object.values(session.participants).filter(p=>p.active)){
    for(const fact of Object.values(person.profile.facts)){
      if(!fact||fact.strength!=='soft'||!/topic|interest|subject/.test(fact.field)||/avoid|dislike|exclude/.test(fact.field))continue;
      for(const value of fact.values){
        if(/\b(?:hate|avoid|dislike|not interested)\b/i.test(value))continue;
        if(/\bAI\b|\bML\b|artificial intelligence|machine learning/i.test(value)&&/artificial intelligence|machine learning|deep learning/i.test(section.title))score++;
        else if(/\bNLP\b|natural language/i.test(value)&&/natural language|language processing/i.test(section.title))score++;
        else if(/database/i.test(value)&&/database/i.test(section.title))score++;
        else if(value.length>=4&&section.title.toLowerCase().includes(value.toLowerCase()))score++;
      }
    }
  }
  return score;
}
