import {catalogSchema,type CatalogResult} from '../integrations/catalog.js';
import {APIClient,APIError} from '../integrations/api.js';
import {ResearchScheduler} from '../research/scheduler.js';
import type {PlanningCatalog,PlanningQuery} from './types.js';

export class PlanningCatalogClient implements PlanningCatalog{
  constructor(private api:APIClient,private scheduler:ResearchScheduler){}
  async search(q:PlanningQuery,signal:AbortSignal):Promise<CatalogResult>{
    const prefix=Boolean(q.catalog&&/^\d{1,2}$/.test(q.catalog));
    const key=q.subject&&q.catalog?`catalog:${q.term}:${q.subject}:${q.catalog}${q.delivery==='O'?':O':''}`:`planning-keyword:${q.term}:${q.keyword}:${q.delivery??'A'}`;
    const result=await this.scheduler.cached(key,120000,false,'asu',signal,()=>this.api.get('/api/search',catalogSchema,
      // ASU's catalogNbr is exact in live searches. Retrieve the level, then enforce the family locally.
      {term:q.term,subject:q.subject??'',catalog_nbr:prefix?'':q.catalog??'',level:prefix?(Number(q.catalog![0])>=5?'grad':'undergrad'):'',keyword:q.keyword??'',search_type:'all',max_pages:'2',campus_or_online_selection:q.delivery??'A'},signal));
    const data=result.value;
    if(data.count!==data.results.length||data.results.some(s=>s.term!==q.term||(q.subject&&s.subject!==q.subject)||(!prefix&&q.catalog&&s.catalog_nbr!==q.catalog)))throw new APIError('invalid_response');
    const results=prefix?data.results.filter(s=>s.catalog_nbr.startsWith(q.catalog!)):data.results;
    return {...data,results,count:results.length};
  }
}
