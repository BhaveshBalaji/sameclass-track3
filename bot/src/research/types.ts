import { z } from 'zod';

export const taskSchema=z.object({
  kind:z.enum(['catalog','details','syllabus','reviews']),subject:z.string().regex(/^[A-Z]{2,5}$/),
  catalog:z.string().regex(/^\d{3}[A-Z]?$/),semester:z.string().max(40),
  professor:z.string().min(2).max(100).nullable(),classNumber:z.string().regex(/^\d+$/).nullable(),
});
export type ResearchTask=z.infer<typeof taskSchema>;
export const planSchema=z.object({tasks:z.array(taskSchema).max(12),clarification:z.string().max(500).nullable(),refresh:z.boolean()});
export type ResearchPlan=z.infer<typeof planSchema>;
export interface Evidence {
  id:string;kind:string;entity:string;status:'ok'|'partial'|'unavailable'|'ambiguous';
  retrievedAt:string;retrievedAtLocal:string;sources:string[];data:unknown;limitations:string[];
  reused:boolean;ageMs:number;
}
export interface WorkerResult {taskId:string;entity:string;status:'ok'|'partial'|'unavailable';evidence:Evidence[];limitations:string[];reviewCoverage?:{pagesFetched:number;reviewsRetrieved:number;courseSpecific:number;complete:boolean}}
export interface ResearchBudget {signal:AbortSignal;tools:number;models:number;maxTools:number;maxModels:number;refresh:boolean}
export const safeResearchError=(error:unknown):string=>error instanceof Error&&error.name==='ResearchLimit'
  ? error.message : error instanceof Error&&['AbortError','TimeoutError'].includes(error.name)
  ? 'Research deadline reached; this source is incomplete.' : 'This source could not be retrieved or validated.';
