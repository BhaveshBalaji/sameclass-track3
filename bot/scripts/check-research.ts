/** Explicit paid live check, public course evidence only. Does not post to Discord. */
import { loadConfig, safeFailure } from '../src/config/index.js';
import { ResearchAgent } from '../src/research/agent.js';
import { ResearchScheduler } from '../src/research/scheduler.js';
import { ResearchSources } from '../src/research/sources.js';
import { APIClient } from '../src/integrations/api.js';
const config=loadConfig();
const scheduler=new ResearchScheduler(config.RESEARCH_GLOBAL_CONCURRENCY,config.RESEARCH_SOURCE_CONCURRENCY);
const sources=new ResearchSources(new APIClient(config.ASU_API_BASE_URL,config.RESEARCH_WORKER_TIMEOUT_MS),new APIClient(config.RMP_API_BASE_URL,config.RESEARCH_WORKER_TIMEOUT_MS),scheduler);
const question=process.argv.slice(2).join(' ')||'For CSE 575 in Spring 2027 with Yingzhen Yang, what does the syllabus say about exams and what do relevant RMP reviews say? Clearly label missing or historical evidence.';
try{
  const agent=new ResearchAgent(config,sources,scheduler,undefined,data=>console.log(JSON.stringify({check:'research',...data})));
  console.log(await agent.answer(question));
}catch(error){safeFailure('research',error);}
