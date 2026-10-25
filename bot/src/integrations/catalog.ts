import { z } from 'zod';
import { APIClient, APIError } from './api.js';

export const sectionSchema = z.object({
  subject: z.string(), catalog_nbr: z.string(), term: z.string(),
  class_nbr: z.string().regex(/^\d+$/), course_id: z.string().regex(/^\d+$/), title: z.string(),
  instructors: z.array(z.object({name: z.string()})),
  meeting_intervals: z.array(z.object({days: z.array(z.string()),start: z.string().nullable(),end: z.string().nullable(),
    start_date: z.string().nullable(),end_date: z.string().nullable(),status: z.enum(['scheduled','unknown'])})),
  timezone: z.string(), open_seats: z.number().int().nonnegative().nullable(), total_seats: z.number().int().nonnegative().nullable(),
  class_url: z.url().refine(value => new URL(value).origin === 'https://catalog.apps.asu.edu'),
  campus: z.string().nullable().optional(), session: z.string().nullable().optional(),
});
export const catalogSchema = z.object({
  count: z.number().int().nonnegative(), total: z.union([z.number().int().nonnegative(),z.object({value:z.number().int().nonnegative(),relation:z.string()})]),
  results: z.array(sectionSchema), pages_fetched: z.number().int().nonnegative(), complete: z.boolean(),
  stop_reason: z.string(), retrieved_at: z.iso.datetime({offset:true}),
});
export type CatalogResult = z.infer<typeof catalogSchema>;
export interface CatalogQuery {term:string;subject:string;catalog:string}
export interface CatalogSource { search(query: CatalogQuery): Promise<CatalogResult> }
export class CatalogClient implements CatalogSource {
  constructor(private api: APIClient) {}
  async search(query: CatalogQuery): Promise<CatalogResult> {
    // All sections, including closed ones; no invisible "open-only" filter.
    const data = await this.api.get('/api/search',catalogSchema,{term:query.term,subject:query.subject,
      catalog_nbr:query.catalog,search_type:'all',max_pages:'2',include_raw:'false'});
    if (data.count !== data.results.length || data.results.some(s => s.term !== query.term
      || s.subject.toUpperCase() !== query.subject || s.catalog_nbr.toUpperCase() !== query.catalog)) {
      throw new APIError('invalid_response');
    }
    return data;
  }
}
