import {z} from 'zod';
import type {PlanningSession} from '../domain/planning.js';
import type {CatalogResult} from '../integrations/catalog.js';

export const days=z.enum(['MON','TUE','WED','THU','FRI','SAT','SUN']);
export const clock=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/);
export const windowSchema=z.object({days:z.array(days).min(1).max(7),start:clock,end:clock,
  startDate:z.iso.date().nullable(),endDate:z.iso.date().nullable(),timezone:z.string()});
export type TimeWindow=z.infer<typeof windowSchema>;
export const constraintSchema=z.object({factKey:z.string(),kind:z.enum(['unavailable','campus','allowed_courses','course_credits','semester_credits','course_count','unrestricted_time','other']),
  understood:z.boolean(),values:z.array(z.string()).max(20),min:z.number().nonnegative().nullable(),max:z.number().nonnegative().nullable(),
  windows:z.array(windowSchema).max(20)});
export type Constraint=z.infer<typeof constraintSchema>;
export const projectionSchema=z.object({queries:z.array(z.object({subject:z.string(),catalog:z.string(),keyword:z.string().max(120)})).max(4),
  participants:z.array(z.object({userId:z.string(),constraints:z.array(constraintSchema).max(40)})).max(12)});
export type Projection=z.infer<typeof projectionSchema>;
export type Section=CatalogResult['results'][number];
export interface Fit {userId:string;name:string;status:'pass'|'conflict'|'unknown';conflicts:string[];unchecked:string[];preferences:string[];softEvidence:string[];softScore:number}
export interface Candidate {section:Section;components:Section[];bundleVerified:boolean;componentNotes:string[];fits:Fit[];covered:number;known:number;shared:boolean}
export interface Recommendation {text:string;sectionIds:string[]}
export interface GroupPlanner {recommend(session:PlanningSession,question:string,signal:AbortSignal):Promise<Recommendation>}
export interface PlanningProjection {project(session:PlanningSession,question:string,signal:AbortSignal):Promise<Projection>}
export interface PlanningQuery {term:string;subject?:string;catalog?:string;keyword?:string;delivery?:'A'|'O'}
export interface PlanningCatalog {search(query:PlanningQuery,signal:AbortSignal):Promise<CatalogResult>}
export interface SoftFitAssessor {assess(session:PlanningSession,evidence:{candidate:Candidate;text:string}[],signal:AbortSignal):Promise<void>}
