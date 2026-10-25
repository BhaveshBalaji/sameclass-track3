import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { repoRoot } from '../src/config/index.js';
import { semesterCode, semesterName, semesterChoices } from '../src/domain/semester.js';
import { APIClient, APIError } from '../src/integrations/api.js';
import { CatalogClient, catalogSchema } from '../src/integrations/catalog.js';
import { CatalogResearch, parseCatalogQuestion, renderCatalog, isCourseQuestion, catalogFields } from '../src/application/catalog.js';
import { messageParts } from '../src/persistence/planning-store.js';

const fixture = () => readFile(join(repoRoot,'class_search_api/example_response.json'),'utf8').then(JSON.parse).then(value => catalogSchema.parse(value));
test('readable semesters map to wire codes and autocomplete uses Phoenix year', () => {
  assert.equal(semesterCode('Spring 2027'),'2271');
  assert.equal(semesterCode('  2027 FALL  '),'2277');
  assert.equal(semesterCode('summer 2027'),'2274');
  assert.equal(semesterCode('2271'),'2271');
  assert.equal(semesterName('2271'),'Spring 2027');
  assert.throws(()=>semesterCode('Spring'),/Spring 2027/);
  assert.throws(()=>semesterCode('Winter 2027'));
  assert.deepEqual(semesterChoices('spring 2027',new Date('2026-10-25T00:00:00Z')),[{name:'Spring 2027',value:'Spring 2027'}]);
});
test('course and semester resolution uses explicit identity, clarifies ambiguity, and never guesses a year', () => {
  assert.deepEqual(parseCatalogQuestion('Who teaches cse512 in Spring 2027?','2267'),{term:'2271',subject:'CSE',catalog:'512'});
  assert.deepEqual(parseCatalogQuestion('Who teaches CSE 512 in our selected semester?','2271'),{term:'2271',subject:'CSE',catalog:'512'});
  assert.match(String(parseCatalogQuestion('CSE 512')),/Which semester/);
  assert.match(String(parseCatalogQuestion('CSE 512 next semester','2271')),/semester and year/);
  assert.match(String(parseCatalogQuestion('CSE 512 in Spring','2271')),/semester and year/);
  assert.match(String(parseCatalogQuestion('CSE 512 in Fall 2027 and Spring 2027')),/one semester/);
  assert.match(String(parseCatalogQuestion('CSE 511 or CSE 512','2271')),/single course/);
  assert.equal(isCourseQuestion('I prefer CSE 512. My availability is after noon.'),false);
  assert.equal(isCourseQuestion('Who teaches CSE 512 and how many seats are there?'),true);
});
test('catalog contract preserves base prefixes, all-seat search and exact term/course identity', async () => {
  const data = await fixture(); let observed:URL|undefined;
  const client = new CatalogClient(new APIClient('https://backend.test/asu',1000,async input => {
    observed=new URL(String(input)); return Response.json(data);
  }));
  await client.search({term:'2271',subject:'CSE',catalog:'575'});
  assert.equal(observed?.pathname,'/asu/api/search');
  assert.equal(observed?.searchParams.get('search_type'),'all');
  assert.equal(observed?.searchParams.get('max_pages'),'2');
  assert.equal(observed?.searchParams.get('term'),'2271');
  await assert.rejects(client.search({term:'2277',subject:'CSE',catalog:'575'}),e=>e instanceof APIError&&e.kind==='invalid_response');
  await assert.rejects(client.search({term:'2271',subject:'CSE',catalog:'512'}));
});
test('unknown seats, instructor and meeting data remain unknown; zero stays zero; partial search is disclosed', async () => {
  const data=await fixture(),query={term:'2271',subject:'CSE',catalog:'575'};
  data.results[0]!.open_seats=null; data.results[0]!.total_seats=null;
  data.results[0]!.instructors=[]; data.results[0]!.meeting_intervals=[];data.complete=false;
  let text=renderCatalog(query,data);
  assert.match(text,/Seats: Unknown/);assert.match(text,/Instructor: Not listed/);assert.match(text,/Meeting times not listed/);
  assert.match(text,/Partial search/);assert.match(text,/Spring 2027/);assert.match(text,/#detailsOpen=99999-000000/);
  assert.doesNotMatch(text,/snapshot v|profile v|2271 ·/);
  data.results[0]!.open_seats=0;assert.match(renderCatalog(query,data),/Seats: 0 open/);
  data.results=[];data.count=0;
  assert.match(renderCatalog(query,data),/cannot confirm there are none/);
  data.complete=true;assert.match(renderCatalog(query,data),/no listings for this course/);
});
test('unsupported syllabus work and missing semester do not call APIs; upstream failure is not empty success', async () => {
  let calls=0;
  const research=new CatalogResearch({async search(){calls++;throw new APIError('http',503);}});
  assert.match(await research.answer('CSE 512 syllabus in Spring 2027'),/not available yet/);
  assert.match(await research.answer('Who teaches CSE 512?'),/Which semester/);
  assert.equal(calls,0);
  const answer=await research.answer('Who teaches CSE 512 in Spring 2027?');
  assert.equal(calls,1);assert.match(answer,/couldn’t retrieve/);assert.doesNotMatch(answer,/no listings/);
});
test('multi-section Discord answers retain source links within message limits', async () => {
  const data=await fixture();
  data.results=Array.from({length:8},(_,i)=>({...data.results[0]!,class_nbr:String(90000+i)}));data.count=8;
  const answer=renderCatalog({term:'2271',subject:'CSE',catalog:'575'},data),parts=messageParts(answer);
  assert.ok(parts.length>1);assert.ok(parts.every(part=>part.length<=1700));
  for(let i=0;i<8;i++)assert.ok(parts.some(part=>part.includes(`**Section ${90000+i}**`)&&part.includes(`#detailsOpen=${90000+i}-000000)`)));
});
test('professor questions deduplicate all fetched sections and omit unrelated section details', async () => {
  const data=await fixture();
  data.results=Array.from({length:9},(_,i)=>({...data.results[0]!,class_nbr:String(90000+i),
    instructors:i===1 ? [] : [{name:i===8 ? 'Another Instructor' : i===2 ? ' example   instructor ' : 'Example Instructor'}]}));
  data.count=9;
  const research=new CatalogResearch({async search(){return data;}});
  const answer=await research.answer('What professors are teaching CSE 240 in Spring 2027?');
  assert.match(answer,/Another Instructor/); // The ninth section must not be dropped.
  assert.equal((answer.match(/example instructor/gi)??[]).length,1);
  assert.match(answer,/1 section has no listed instructor/);
  assert.doesNotMatch(answer,/Seats:|Meeting times|Section 900|TEMPE|reservations/);
  assert.equal((answer.match(/\]\(https:/g)??[]).length,1);
  assert.ok(answer.length<700);
  data.complete=false;
  assert.match(await research.answer('Who teaches CSE 240 in Spring 2027?'),/Partial search/);
  data.results.forEach(s=>{s.instructors=[];});
  assert.match(await research.answer('Who teaches CSE 240 in Spring 2027?'),/has not listed instructors/);
  data.results=[];data.count=0;data.complete=true;
  assert.match(await research.answer('Who teaches CSE 240 in Spring 2027?'),/no listings/);
});
test('combined and other catalog questions show only requested fields', async () => {
  const data=await fixture(),research=new CatalogResearch({async search(){return data;}});
  assert.deepEqual(catalogFields('Who teaches CSE 575 and are there seats?'),['instructors','seats']);
  assert.deepEqual(catalogFields('List professors across all sections of CSE 575'),['instructors']);
  const combined=await research.answer('Who teaches CSE 575 in Spring 2027 and are there seats?');
  assert.match(combined,/Instructor:/);assert.match(combined,/Seats:/);assert.doesNotMatch(combined,/13:00|America\/Phoenix/);
  const times=await research.answer('When does CSE 575 meet in Spring 2027?');
  assert.match(times,/13:00/);assert.doesNotMatch(times,/Instructor:|Seats:/);
});
