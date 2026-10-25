import {z} from 'zod';
import type {PlanningSession} from '../domain/planning.js';
import type {Evidence} from '../research/types.js';
import type {CatalogResult} from '../integrations/catalog.js';

export const days=z.enum(['MON','TUE','WED','THU','FRI','SAT','SUN']);
export const clock=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/);
export const windowSchema=z.object({days:z.array(days).min(1).max(7),start:clock,end:clock,
  startDate:z.iso.date().nullable(),endDate:z.iso.date().nullable(),timezone:z.string()});
export type TimeWindow=z.infer<typeof windowSchema>;
export const constraintSchema=z.object({factKey:z.string(),kind:z.enum(['unavailable','available','campus','allowed_courses','course_family','course_credits','semester_credits','course_count','unrestricted_time','other']),
  understood:z.boolean(),values:z.array(z.string()).max(20),min:z.number().nonnegative().nullable(),max:z.number().nonnegative().nullable(),
  windows:z.array(windowSchema).max(20)});
export type Constraint=z.infer<typeof constraintSchema>;
export const projectionSchema=z.object({queries:z.array(z.object({subject:z.string(),catalog:z.string(),keyword:z.string().max(120)})).max(4),
  participants:z.array(z.object({userId:z.string(),constraints:z.array(constraintSchema).max(40)})).max(12)});
export type Projection=z.infer<typeof projectionSchema>;
export type Section=CatalogResult['results'][number];
export interface Fit {userId:string;name:string;status:'pass'|'conflict'|'unknown';conflicts:string[];unchecked:string[];preferences:string[];softEvidence:string[];softScore:number;timeStatus?:'checked'|'unknown'|'conflict'}
export interface Candidate {section:Section;components:Section[];bundleVerified:boolean;componentNotes:string[];fits:Fit[];covered:number;known:number;shared:boolean;research?:OfferingResearch;findings?:Finding[]}
export interface Recommendation {text:string;sectionIds:string[];inlineMentions?:{marker:string;userId:string}[];assignments?:{userId:string;requested:number;sectionIds:string[]}[];
  spoken?:{members:{name:string;requested:number;choices:{course:string;section:string;instructors:string[];meetings:string;reasons:string[];unchecked:string[]}[]}[];shared:{course:string;names:string[];preliminary:boolean}[];limitations:string[]}}
export interface GroupPlanner {recommend(session:PlanningSession,question:string,signal:AbortSignal):Promise<Recommendation>}
export interface PlanningProjection {project(session:PlanningSession,question:string,signal:AbortSignal):Promise<Projection>}
export interface PlanningQuery {term:string;subject?:string;catalog?:string;keyword?:string;delivery?:'A'|'O'}
export interface PlanningCatalog {search(query:PlanningQuery,signal:AbortSignal):Promise<CatalogResult>}
export interface Finding {category:'topics'|'workload'|'grading'|'reviews';note:string;quote:string;evidenceId:string;caution:boolean}
export interface OfferingResearch {sectionId:string;evidence:Evidence[];limitations:string[]}
export interface PlanningResearch {inspect(section:Section,term:string,signal:AbortSignal,budget?:import('../research/types.js').ResearchBudget):Promise<OfferingResearch>}
export interface SoftFitAssessor {assess(session:PlanningSession,evidence:{candidate:Candidate;text:string;records?:Evidence[]}[],signal:AbortSignal):Promise<void>}
export interface StudentSchedule {userId:string;requested:number;target:number;candidates:Candidate[];countKnown:boolean}
export interface GroupSchedule {students:StudentSchedule[];sharedPairs:number;searchedStates:number;bounded:boolean}
