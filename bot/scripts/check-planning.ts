import {PlanningResearchClient} from '../src/planning/research.js';
/** One opt-in paid demonstration. Synthetic students, live model/APIs, isolated state, no Discord posts. */
import {loadConfig,safeFailure} from '../src/config/index.js';
import {preferenceModel} from '../src/model/preferences.js';
import {fixture,testDatabase,harness,baseScenario,cleanup} from './replay-support.js';
import {PlanningCatalogClient} from '../src/planning/catalog.js';
import {ModelPlanningProjection} from '../src/planning/projector.js';
import {ModelSoftFit} from '../src/planning/soft-fit.js';
import {GroupPlanningEngine} from '../src/planning/engine.js';
import {ResearchAgent} from '../src/research/agent.js';
import {ResearchSources} from '../src/research/sources.js';
import {ResearchScheduler} from '../src/research/scheduler.js';
import {APIClient} from '../src/integrations/api.js';

const config=loadConfig();let pool:Awaited<ReturnType<typeof testDatabase>>|undefined,namespace:string|undefined;
try{
  pool=await testDatabase();const h=harness(pool,preferenceModel(config));namespace=h.namespace;
  await baseScenario(h,await fixture());const session=(await h.store.read(h.room))!;
  const scheduler=new ResearchScheduler(),asu=new APIClient(config.ASU_API_BASE_URL,20000),rmp=new APIClient(config.RMP_API_BASE_URL,20000);
  const research=new ResearchAgent(config,new ResearchSources(asu,rmp,scheduler),scheduler);
  const planner=new GroupPlanningEngine(new ModelPlanningProjection(config,scheduler),new PlanningCatalogClient(asu,scheduler),new PlanningResearchClient(config,new ResearchSources(asu,rmp,scheduler)),
    {candidates:12,shortlist:1,timeoutMs:90000},new ModelSoftFit(config,scheduler));
  const result=await planner.recommend(session,'Find one shared elective for the joined students using their own requirements.',AbortSignal.timeout(90000));
  // Do not print raw student messages, model reasoning, review payloads or signed document URLs.
  console.log('SIMULATED STUDENT CONVERSATION — live model and ASU/RMP evidence; no Discord posts.');
  console.log(result.text.replace(/\]\((https?:\/\/[^)]*)\)/g,(_match,url:string)=>{
    const u=new URL(url);return u.hostname.endsWith('.amazonaws.com')?'](signed-document-link-redacted)':`](${url})`;
  }));
  console.log(JSON.stringify({participants:Object.keys(session.participants).length,sectionIds:result.sectionIds,fullSchedule:'not_claimed'}));
}catch(error){safeFailure('group-planning',error);}
finally{if(pool){if(namespace)await cleanup(pool,namespace);await pool.end();}}
