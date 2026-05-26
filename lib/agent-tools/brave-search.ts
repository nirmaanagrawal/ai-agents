/**
 * brave_search — Brave Search API tool.
 *
 * Why this earns its keep for prospecting:
 *   DuckDuckGo Instant Answer is a lookup, not a search engine — it
 *   returns Wikipedia-style abstracts for entities it already knows
 *   about. For long-tail discovery ("which US Series-B SaaS companies
 *   are hiring engineers in Bangalore?"), we need real SERP results.
 *   Brave Search API gives that at $5/mo for 20k queries — by far the
 *   best quality-per-dollar option among keyless / cheap web search.
 *
 * Setup:
 *   1. Sign up at https://brave.com/search/api/
 *   2. Pro plan ($5/mo for 20k queries) → grab API key
 *   3. Set BRAVE_API_KEY in Vercel project env vars
 *   4. Redeploy
 *
 * Without the env var the tool degrades gracefully: returns
 * `{ error: '...not configured' }` so the agent can fall back to
 * DuckDuckGo. We never silently no-op; the agent should always know
 * when a tool isn't available.
 *
 * API reference:
 *   https://api.search.brave.com/app/documentation/web-search/query
 */
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const TIMEOUT_MS = 8_000;
const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
  page_age?: string;
}
interface BraveResponse {
  web?: { results?: BraveWebResult[] };
  news?: { results?: BraveWebResult[] };
}

export const braveSearchTool = tool(
  'brave_search',
  'Search the open web via Brave Search API. Use this for DISCOVERY — finding companies, people, news, or pages that DuckDuckGo Instant Answer can\'t cover (i.e., anything beyond well-known Wikipedia entities). Critical for prospecting work where you need to discover companies by criteria like "Series B SaaS companies hiring engineers in Bangalore" rather than look up a known company. Returns the top 10 web results with title, URL, snippet, and age. Returns {error} if BRAVE_API_KEY is not configured — fall back to search_web (DDG) in that case.',
  {
    query: z
      .string()
      .min(3)
      .max(400)
      .describe(
        'Search query. Be specific. Use quoted phrases for exact match, site: operators where helpful. Examples: "company name India office Bangalore engineering", "Series B SaaS hiring Bangalore engineering 2026", "site:linkedin.com {company} india engineers".',
      ),
    freshness: z
      .enum(['pd', 'pw', 'pm', 'py', 'all'])
      .optional()
      .describe(
        'Time filter: pd=past day, pw=past week, pm=past month, py=past year, all=any time. Use pm/py for active-hiring signals; all for company facts.',
      ),
    count: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('How many results to return (1-20, default 10).'),
  },
  async ({ query, freshness, count }) => {
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) {
      return text({
        query,
        error:
          'BRAVE_API_KEY is not configured on the server. Discovery search is unavailable; fall back to search_web (DuckDuckGo Instant Answer) for known companies, or report to the visitor that we need this enabled.',
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const t0 = Date.now();

    try {
      const params = new URLSearchParams({
        q: query,
        // Brave's documented defaults; we keep them explicit so debugging
        // is easier if results look off later.
        country: 'us',
        search_lang: 'en',
        safesearch: 'moderate',
        count: String(count ?? 10),
      });
      if (freshness && freshness !== 'all') params.set('freshness', freshness);

      const res = await fetch(`${ENDPOINT}?${params}`, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': apiKey,
        },
      });

      if (res.status === 429) {
        return text({
          query,
          error:
            'Brave Search quota exceeded for this month. Either bump the plan at brave.com/search/api or fall back to search_web for the remaining queries.',
        });
      }
      if (!res.ok) {
        return text({
          query,
          error: `Brave Search HTTP ${res.status}: ${res.statusText}`,
        });
      }

      const data = (await res.json()) as BraveResponse;
      const web = (data.web?.results ?? []).slice(0, count ?? 10).map((r) => ({
        title: trim(r.title, 200),
        url: trim(r.url, 300),
        snippet: trim(r.description, 400),
        age: r.age ?? r.page_age ?? undefined,
      }));

      return text({
        query,
        count: web.length,
        results: web,
        elapsedMs: Date.now() - t0,
      });
    } catch (e) {
      return text({
        query,
        error: controller.signal.aborted
          ? `Brave Search timed out after ${TIMEOUT_MS}ms`
          : String(e),
      });
    } finally {
      clearTimeout(timer);
    }
  },
);

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}
function trim(s: string | undefined, n: number): string {
  if (!s) return '';
  // Strip Brave's <strong> highlighting markup before returning.
  const cleaned = s.replace(/<\/?strong[^>]*>/gi, '').replace(/\s+/g, ' ').trim();
  return cleaned.length > n ? cleaned.slice(0, n - 1) + '…' : cleaned;
}
