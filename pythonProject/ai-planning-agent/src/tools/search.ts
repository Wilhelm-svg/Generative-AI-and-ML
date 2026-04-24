import type { Tool } from '../types.js';

/**
 * Real web search using Tavily API (free tier: 1000 searches/month)
 * Falls back to DuckDuckGo Instant Answer if TAVILY_API_KEY not set
 */
export const searchTool: Tool = {
  name: 'search',
  async invoke(params: Record<string, unknown>): Promise<unknown> {
    const query = params['query'] as string;
    if (!query) throw new Error('Missing query parameter');

    const tavilyKey = process.env.TAVILY_API_KEY;

    if (tavilyKey) {
      return tavilySearch(query, tavilyKey);
    }

    return duckduckgoSearch(query);
  },
};

async function tavilySearch(query: string, apiKey: string): Promise<unknown> {
  const requestBody = {
    api_key: apiKey,
    query,
    search_depth: 'basic',
    max_results: 5,
    include_answer: true,
  };
  
  console.log('[SEARCH] Tavily request:', JSON.stringify(requestBody).substring(0, 200));
  
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  console.log('[SEARCH] Tavily response status:', res.status);
  
  if (!res.ok) {
    const errorText = await res.text();
    console.log('[SEARCH] Tavily error response:', errorText);
    throw new Error(`Tavily search failed: ${res.status}`);
  }

  const data = await res.json() as {
    answer?: string;
    results: { title: string; url: string; content: string }[];
  };

  return {
    query,
    answer: data.answer ?? null,
    results: data.results.map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.content.slice(0, 300),
    })),
    source: 'Tavily',
  };
}

async function duckduckgoSearch(query: string): Promise<unknown> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'ai-planning-agent/1.0' } });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);

  const data = await res.json() as {
    AbstractText?: string;
    AbstractURL?: string;
    RelatedTopics?: { Text?: string; FirstURL?: string }[];
  };

  const results: string[] = [];
  if (data.AbstractText) results.push(data.AbstractText);
  data.RelatedTopics?.slice(0, 3).forEach(t => { if (t.Text) results.push(t.Text); });

  return {
    query,
    answer: data.AbstractText ?? null,
    results: results.length > 0 ? results : [`No results found for: ${query}`],
    source: 'DuckDuckGo',
  };
}
