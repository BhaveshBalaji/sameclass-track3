import {catalogSchema,type CatalogResult} from '../integrations/catalog.js';
import {APIClient,APIError} from '../integrations/api.js';
import {ResearchScheduler} from '../research/scheduler.js';
import type {PlanningCatalog,PlanningQuery} from './types.js';

export class PlanningCatalogClient implements PlanningCatalog{
  constructor(private api:APIClient,private scheduler:ResearchScheduler){}
  async search(q:PlanningQuery,signal:AbortSignal):Promise<CatalogResult>{
    const key=q.subject&&q.catalog?`catalog:${q.term}:${q.subject}:${q.catalog}${q.delivery==='O'?':O':''}`:`planning-keyword:${q.term}:${q.keyword}:${q.delivery??'A'}`;
    const result=await this.scheduler.cached(key,120000,false,'asu',signal,()=>this.api.get('/api/search',catalogSchema,
      {term:q.term,subject:q.subject??'',catalog_nbr:q.catalog??'',keyword:q.keyword??'',search_type:'all',max_pages:'2',campus_or_online_selection:q.delivery??'A'},signal));
    const data=result.value;
    if(data.count!==data.results.length||data.results.some(s=>s.term!==q.term||(q.subject&&s.subject!==q.subject)||(q.catalog&&s.catalog_nbr!==q.catalog)))throw new APIError('invalid_response');
    return data;
  }
}
