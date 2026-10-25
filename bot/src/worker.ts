import {PlanningResearchClient} from './planning/research.js';
import { loadConfig, safeFailure } from './config/index.js';
import { createPool } from './persistence/database.js';
import { PlanningApplication } from './application/planning.js';
import { PlanningStore } from './persistence/planning-store.js';
import { preferenceModel } from './model/preferences.js';
import { connectDiscord } from './transport/discord/index.js';
import {ModelSoftFit} from './planning/soft-fit.js';
import {GroupPlanningEngine} from './planning/engine.js';
import {PlanningCatalogClient} from './planning/catalog.js';
import {ModelPlanningProjection} from './planning/projector.js';
import { ResearchAgent } from './research/agent.js';
import { ResearchSources } from './research/sources.js';
import { ResearchScheduler } from './research/scheduler.js';
import { APIClient } from './integrations/api.js';

async function main() {
  const config = loadConfig();
  const pool = createPool(config);
  try {
    await pool.query('SELECT 1');
    await Promise.all([new APIClient(config.ASU_API_BASE_URL, config.API_TIMEOUT_MS).health(),
      new APIClient(config.RMP_API_BASE_URL, config.API_TIMEOUT_MS).health()]);
    const store = new PlanningStore(pool);
    await store.recover();
    const scheduler=new ResearchScheduler(config.RESEARCH_GLOBAL_CONCURRENCY,config.RESEARCH_SOURCE_CONCURRENCY);
    const sources=new ResearchSources(new APIClient(config.ASU_API_BASE_URL,config.RESEARCH_WORKER_TIMEOUT_MS),
      new APIClient(config.RMP_API_BASE_URL,config.RESEARCH_WORKER_TIMEOUT_MS),scheduler,
      config.RESEARCH_MAX_SECTIONS,config.RESEARCH_SEAT_CACHE_MS,config.RESEARCH_EVIDENCE_CACHE_MS);
    const research = new ResearchAgent(config,sources,scheduler,pool);
    const planner=new GroupPlanningEngine(new ModelPlanningProjection(config,scheduler),
      new PlanningCatalogClient(new APIClient(config.ASU_API_BASE_URL,config.API_TIMEOUT_MS),scheduler),new PlanningResearchClient(config,sources),
      {candidates:config.PLANNING_MAX_CANDIDATES,shortlist:config.PLANNING_RESEARCH_SHORTLIST,timeoutMs:config.PLANNING_TIMEOUT_MS,sourceCalls:config.RESEARCH_MAX_SOURCE_CALLS},new ModelSoftFit(config,scheduler));
    const application = config.DISCORD_BOT_TOKEN ? new PlanningApplication(store,preferenceModel(config),{
      messages: config.PLANNING_MAX_MESSAGES, characters: config.PLANNING_MAX_CHARACTERS,
      participants: config.PLANNING_MAX_PARTICIPANTS,
    },research,planner) : undefined;
    const discord = application ? await connectDiscord(config,application) : undefined;
    console.log(discord ? 'Ray is online. Planning and research are ready.' : 'Ray is ready. Configure Discord credentials to connect.');
    // Foundation mode also stays running, without periodic log chatter.
    const idle = discord ? undefined : setInterval(() => {},60000);
    const shutdown = async () => { clearInterval(idle); discord?.destroy(); await pool.end(); process.exit(0); };
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  } catch (error) { await pool.end(); throw error; }
}
main().catch(error => safeFailure('worker', error));
