import type { Tool } from '../types.js';

/**
 * Real HTTP API tool — makes actual fetch requests
 */
export const httpApiTool: Tool = {
  name: 'http-api',
  async invoke(params: Record<string, unknown>): Promise<unknown> {
    const url = params['url'] as string;
    const method = ((params['method'] as string) ?? 'GET').toUpperCase();
    const body = params['body'];
    const headers = (params['headers'] as Record<string, string>) ?? {};

    if (!url) throw new Error('Missing url parameter');

    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    if (body && method !== 'GET') {
      options.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const res = await fetch(url, options);
    const text = await res.text();
    let responseBody: unknown = text;
    try { responseBody = JSON.parse(text); } catch { /* keep as text */ }

    return { status: res.status, ok: res.ok, body: responseBody };
  },
};
