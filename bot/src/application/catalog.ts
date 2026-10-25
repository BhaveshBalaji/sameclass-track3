import { clean } from '../domain/planning.js';
import { semesterCode, semesterName } from '../domain/semester.js';
import type { CatalogQuery, CatalogResult, CatalogSource } from '../integrations/catalog.js';

export interface CourseResearch { answer(question:string,activeTerm?:string):Promise<string> }
/** Fast path for explicit information questions; group planning still uses its classifier. */
export function isCourseQuestion(text:string):boolean {
  return /\b(?:who|what|how|are there|is there|show|check|list|tell me)\b/i.test(text)
    && /\b(?:teach(?:es|ing)?|seats?|availability|sections?|meeting|syllabus|syllabi|instructors?|professors?|about)\b/i.test(text)
    && !/\b(?:summari[sz]e|our preferences|my preferences)\b/i.test(text);
}
export function parseCatalogQuestion(question:string, activeTerm?:string): CatalogQuery | string {
  const text = question.replace(/<@!?\d+>/g,'');
  if (/\b(?:syllabus|syllabi|reviews?|rate my professor|rmp|workload|prerequisites?|what is .+ about)\b/i.test(text)) {
    return 'I can look up listed instructors, sections, meeting times and seats. Syllabus, reviews and deeper course research are not available yet.';
  }
  const courses = [...text.matchAll(/\b([a-z]{2,5})\s*-?\s*(\d{3}[a-z]?)\b/gi)]
    .map(m => ({subject:m[1]!.toUpperCase(),catalog:m[2]!.toUpperCase()}));
  const unique = [...new Map(courses.map(c => [`${c.subject} ${c.catalog}`,c])).values()];
  if (unique.length !== 1) return 'Which single course should I look up? For example: “Who teaches CSE 512 in Spring 2027, and are there seats?”';
  const terms = [...text.matchAll(/\b(?:(?:spring|summer|fall|autumn)\s+20\d{2}|20\d{2}\s+(?:spring|summer|fall|autumn))\b/gi)].map(m => semesterCode(m[0]));
  const codes = [...text.replace(/\b20\d{2}\b/g,'').matchAll(/\b2\d{2}[147]\b/g)].map(m=>m[0]);
  const explicit = [...new Set([...terms,...codes])];
  if (explicit.length > 1) return 'Please choose one semester for this lookup, such as Spring 2027.';
  // Do not silently use the active semester for an explicit but incomplete/relative semester.
  if (!explicit.length && /\b(?:spring|summer|fall|autumn|20\d{2}|semester|term|next|this year)\b/i.test(text)
      && !/\b(?:our|selected|active|planning)\s+(?:semester|term)\b/i.test(text)) {
    return 'Which semester and year do you mean? For example, Spring 2027.';
  }
  const term = explicit[0] ?? activeTerm;
  if (!term) return 'Which semester should I use? Include a name and year, such as Spring 2027.';
  return {term,...unique[0]!};
}
export function catalogUrl(q:CatalogQuery):string {
  const url = new URL('https://catalog.apps.asu.edu/catalog/classes/classlist');
  for (const [k,v] of Object.entries({campusOrOnlineSelection:'A',honors:'F',promod:'F',searchType:'all',subject:q.subject,catalogNbr:q.catalog,term:q.term})) url.searchParams.set(k,v);
  return url.toString();
}
export function renderCatalog(q:CatalogQuery,data:CatalogResult):string {
  const course = `${q.subject} ${q.catalog}`, limit=8;
  const sections = data.results.slice(0,limit).map(s => {
    const instructors = s.instructors.map(i=>i.name.trim()).filter(Boolean);
    const meetings = s.meeting_intervals.map(m => m.status === 'scheduled' && m.start && m.end && m.days.length
      ? `${m.days.map(clean).join('/')} ${clean(m.start)}–${clean(m.end)}${m.start_date && m.end_date ? ` (${clean(m.start_date)}–${clean(m.end_date)})` : ''}`
      : 'Meeting times not listed');
    // Build the ASU link from validated identity, never from model-generated/source text.
    const url = `${catalogUrl(q)}#detailsOpen=${s.class_nbr}-${s.course_id}`;
    return `**Section ${s.class_nbr}** · ${clean(s.title.slice(0,150))}\n`
      + `Instructor: ${instructors.length ? instructors.map(n=>clean(n.slice(0,100))).join(', ') : 'Not listed'}\n`
      + `Seats: ${s.open_seats === null ? 'Unknown' : `${s.open_seats} open`}${s.total_seats === null ? '' : ` / ${s.total_seats} total`}\n`
      + `${meetings.join('; ') || 'Meeting times not listed'} · ${clean(s.timezone)}`
      + `${s.campus ? ` · ${clean(s.campus)}` : ''}${s.session ? ` · Session ${clean(s.session)}` : ''}\n[ASU section](${url})`;
  });
  const total = typeof data.total === 'number' ? String(data.total) : `${data.total.value}${data.total.relation === 'eq' ? '' : '+'}`;
  const coverage = data.complete ? `Search complete: ${data.count} section(s) returned.`
    : `Partial search: ${data.count} section(s) returned, ${total} reported by ASU across ${data.pages_fetched} page(s). More listings may exist.`;
  const empty = data.complete ? 'ASU returned no listings for this course and semester.' : 'No listings returned in this partial search; I cannot confirm there are none.';
  return `**${course} · ${semesterName(q.term)}**\n\n${sections.join('\n\n') || empty}\n\n${coverage}`
    + (data.count>limit ? ` Showing the first ${limit}; [view all on ASU](${catalogUrl(q)}).` : ` [ASU search](${catalogUrl(q)}).`)
    + `\nChecked ${new Date(data.retrieved_at).toLocaleString('en-US',{timeZone:'America/Phoenix',timeZoneName:'short'})}. Seats are observations, not reservations or eligibility checks.`;
}
export class CatalogResearch implements CourseResearch {
  constructor(private source:CatalogSource) {}
  async answer(question:string,activeTerm?:string):Promise<string> {
    const query = parseCatalogQuestion(question,activeTerm);
    if (typeof query === 'string') return query;
    try {return renderCatalog(query,await this.source.search(query));}
    catch {return `I couldn’t retrieve reliable ASU listings for ${query.subject} ${query.catalog} in ${semesterName(query.term)}. Try again shortly or check [ASU directly](${catalogUrl(query)}).`;}
  }
}
