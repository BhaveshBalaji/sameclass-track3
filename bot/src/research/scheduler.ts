import { APIError } from '../integrations/api.js';

export class ResearchLimit extends Error {constructor(message:string){super(message);this.name='ResearchLimit';}}
export interface Cached<T> {value:T;reused:boolean;ageMs:number}
/** One process-wide queue for all requests; slots are held until the underlying operation settles. */
export class ResearchScheduler {
  private active=0;
  private counts=new Map<string,number>();
  private changed=new Set<()=>void>();
  private cache=new Map<string,{value:unknown;at:number}>();
  private pending=new Map<string,Promise<Cached<unknown>>>();
  private cooldown=new Map<string,number>();
  constructor(private global=4,private perSource=2,private cacheLimit=256){}
  async run<T>(source:string,signal:AbortSignal,work:()=>Promise<T>):Promise<T> {
    while(true){
      signal.throwIfAborted();
      if((this.cooldown.get(source)??0)>Date.now())throw new ResearchLimit('Source is rate limited; retry later.');
      if(this.active<this.global&&(this.counts.get(source)??0)<this.perSource){
        this.active++;this.counts.set(source,(this.counts.get(source)??0)+1);break;
      }
      await new Promise<void>((resolve,reject)=>{
        const cleanup=()=>{this.changed.delete(wake);signal.removeEventListener('abort',abort);};
        const wake=()=>{cleanup();resolve();};const abort=()=>{cleanup();reject(signal.reason);};
        this.changed.add(wake);signal.addEventListener('abort',abort,{once:true});
        if(signal.aborted)abort();
      });
    }
    try{return await work();}
    catch(error){
      if(error instanceof APIError&&(error.status===429||error.status===503))this.cooldown.set(source,Date.now()+(error.retryAfterMs??10000));
      throw error;
    }finally{
      this.active--;this.counts.set(source,(this.counts.get(source)??1)-1);
      for(const wake of [...this.changed])wake();
    }
  }
  async cached<T>(key:string,ttl:number,refresh:boolean,source:string,signal:AbortSignal,work:()=>Promise<T>):Promise<Cached<T>> {
    signal.throwIfAborted();
    const hit=this.cache.get(key);
    if(!refresh&&hit&&Date.now()-hit.at<ttl)return {value:hit.value as T,reused:true,ageMs:Date.now()-hit.at};
    // Waiters can cancel independently. An owner's cancellation is reported as partial,
    // rather than silently starting another source call while the original is still running.
    const existing=this.pending.get(key);
    if(existing)return this.wait(existing,signal).then(hit=>({...hit,reused:true})) as Promise<Cached<T>>;
    const pending=this.run(source,signal,work).then(value=>{
      if(this.cache.size>=this.cacheLimit)this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key,{value,at:Date.now()});return {value,reused:false,ageMs:0};
    });
    this.pending.set(key,pending);
    const remove=()=>{if(this.pending.get(key)===pending)this.pending.delete(key);};
    void pending.then(remove,remove);
    return this.wait(pending,signal);
  }
  private wait<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
    return new Promise((resolve,reject)=>{
      const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
      if(signal.aborted)abort();
      promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
    });
  }
}
