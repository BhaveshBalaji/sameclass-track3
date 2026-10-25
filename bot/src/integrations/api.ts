import { z } from 'zod';

const healthSchema = z.object({ status: z.literal('ok'), service: z.string(), version: z.string() });
export class APIError extends Error {
  constructor(readonly kind: 'http' | 'timeout' | 'network' | 'invalid_response', readonly status?: number, readonly retryAfterMs?: number) {
    super(`API request failed (${kind}${status ? `, HTTP ${status}` : ''}).`);
  }
}
/** Base paths survive deployment under /asu or /rmp; no hostname belongs in workflow code. */
export class APIClient {
  constructor(private baseUrl: string, private timeoutMs: number, private request: typeof fetch = fetch) {}
  async get<T>(path: string, responseSchema: z.ZodType<T>, params: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
    if (!path.startsWith('/') || path.includes('..') || path.includes('://')) throw new Error('Expected a relative API path.');
    const url = new URL(`${this.baseUrl.replace(/\/+$/, '')}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    let response: Response;
    try { response = await this.request(url, { signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs), redirect: 'error' }); }
    catch (error) {
      throw new APIError(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'timeout' : 'network');
    }
    if (!response.ok) {
      const retry = response.headers.get('retry-after');
      const delay = retry ? (/^\d+(?:\.\d+)?$/.test(retry) ? Number(retry)*1000 : Date.parse(retry)-Date.now()) : undefined;
      throw new APIError('http', response.status,delay !== undefined && Number.isFinite(delay) ? Math.max(0,delay) : undefined);
    }
    try { return responseSchema.parse(await response.json()); }
    catch { throw new APIError('invalid_response'); }
  }
  health() { return this.get('/health', healthSchema); }
}
