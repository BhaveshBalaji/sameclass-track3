import type {SyllabusCoverage} from './syllabus-view.js';
import { z } from 'zod';

export const taskSchema=z.object({
  kind:z.enum(['catalog','discovery','details','syllabus','reviews']),subject:z.union([z.string().regex(/^[A-Z]{2,5}$/),z.literal('')]),
  keyword:z.string().trim().min(1).max(120).nullable().default(null).describe('Topic to search, e.g. database for database-related courses. Supply for discovery; null for other tasks.'),
  catalog:z.union([z.string().regex(/^\d{3}[A-Z]?$/),z.literal('')]),semester:z.string().max(40),
  professor:z.string().min(2).max(100).nullable(),classNumber:z.string().regex(/^\d+$/).nullable(),
});
export type ResearchTask=Omit<z.infer<typeof taskSchema>,'keyword'>&{keyword?:string|null;delivery?:'A'|'O'};
export const planSchema=z.object({tasks:z.array(taskSchema).max(12),clarification:z.string().max(500).nullable(),refresh:z.boolean(),directAnswer:z.string().max(1500).nullable().default(null)});
export type ResearchPlan=Omit<z.infer<typeof planSchema>,'tasks'>&{tasks:ResearchTask[]};
export interface ResearchTurn {pendingQuestion?:string;requestId:string;parentRequestId?:string;userId?:string;question:string;answer:string;tasks:ResearchTask[];instructors:string[];sources?:string[];syllabusCoverage?:SyllabusCoverage[]}
export interface ResearchContext {offeringScope?:{subject:string;catalog:string;semester:string;sectionId:string;instructors:string[];delivery?:'A'|'O'};signal?:AbortSignal;turns:ResearchTurn[];result?:{pendingQuestion?:string;tasks:ResearchTask[];instructors:string[];sources?:string[];syllabusCoverage?:SyllabusCoverage[]}}
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
