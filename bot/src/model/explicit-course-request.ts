import type {ExtractionInput,Patch,Fact} from '../domain/planning.js';

/** Literal first-person counts are source facts, not a model guess or a degree-eligibility claim. */
export function explicitCourseRequest(input:ExtractionInput,patch:Patch):Patch{
  let count:Fact|undefined,family:Fact|undefined;
  const numbers:Record<string,string>={one:'1',two:'2',three:'3',four:'4'};
  for(const message of input.messages){
    if(message.authorId!==input.userId||message.ignored)continue;
    const match=message.content.match(/^\s*(?:correction[,;:]?\s*)?i\s+(?:just\s+)?(?:need(?:\s+to\s+take)?|must\s+take|have\s+to\s+take|want\s+to\s+take)\s+(one|two|three|four|[1-9]\d?)\s+(?:([a-z]{2,5})\s*([1-9])xx\s+)?courses?\b/i);
    if(!match)continue;
    const source={messageId:message.id,quote:match[0]};
    count={field:'course_count',strength:'hard',values:[numbers[match[1]!.toLowerCase()]??match[1]!],sources:[source]};
    if(match[2]&&match[3])family={field:'course_family',strength:'hard',values:[`${match[2].toUpperCase()} ${match[3]}xx`],sources:[source]};
  }
  return {facts:[...patch.facts.filter(f=>!(count&&f.field==='course_count')&&!(family&&f.field==='course_family')),...(count?[count]:[]),...(family?[family]:[])]};
}
