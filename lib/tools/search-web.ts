/**
 * searchWeb — DuckDuckGo Instant Answer API.
 *
 * Why DDG Instant Answer (and not full DDG search)?
 *   DDG's free public API (api.duckduckgo.com) returns *instant answers*
 *   only: Wikipedia-style abstracts, bangs, related topics. It does NOT
 *   return general web results. Scraping DDG HTML search pages is against
 *   their ToS and is rate-limited aggressively.
 *
 *   For company research this is still useful — well-known brands, public
 *   companies, and anything with a Wikipedia article hits. For long-tail
 *   private companies it returns empty, and the agent should fall back to
 *   the `fetchWebpage` tool on the company's domain.
 *
 * No API key required. We give the tool a 6s timeout and always return a
 * structured object (never throw) so a failed call doesn't kill the agent
 * run — the LLM just sees `{ error: '...' }` and can try a different tactic.
 */
import { tool } from 'ai';
import { z } from 'zod';

const DDG_TIMEOUT_MS = 6_000;

interface DdgRelated {
  Text?: unknown;
  FirstURL?: unknown;
  Topics?: unknown;
}

interface DdgResponse {
  Abstract?: unknown;
  AbstractSource?: unknown;
  AbstractURL?: unknown;
  Heading?: unknown;
  RelatedTopics?: unknown;
  Type?: unknown;
}

export const searchWeb = tool({
  description:
    'Search the public web via DuckDuckGo for factual information — what a company does, recent news, public funding events, industry classifications. ' +
    'Works best on well-known entities (Wikipedia-worthy companies, public figures, established brands). ' +
    'Returns an abstract + up to 5 related topics. Returns {error} on failure; you may retry with a narrower query.',
  parameters: z.object({
    query: z
      .string()
      .min(2)
      .max(200)
      .describe(
        'Focused search query, e.g. "Stripe payments company" or "OpenAI Series F funding 2024". ' +
          'Avoid generic terms; be specific. Prefer the exact company name.',
      ),
  }),
  execute: async ({ query }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DDG_TIMEOUT_MS);
    const t0 = Date.now();

    try {
      const url =
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}` +
        `&format=json&no_html=1&skip_disambig=1&t=agent-marketplace`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        return { error: `DuckDuckGo returned HTTP ${res.status}`, query };
      }
      const data = (await res.json()) as DdgResponse;

      const abstract = asString(data.Abstract);
      const heading = asString(data.Heading);

      // Flatten the related-topics tree. DDG sometimes nests `Topics` inside
      // a `RelatedTopics` entry when the query is a category rather than a
      // single entity — both shapes carry useful link+blurb pairs.
      const rawTopics = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];
      const flatTopics: DdgRelated[] = [];
      for (const t of rawTopics) {
        if (!t || typeof t !== 'object') continue;
        const rel = t as DdgRelated;
        if (Array.isArray(rel.Topics)) {
          for (const inner of rel.Topics) {
            if (inner && typeof inner === 'object') flatTopics.push(inner as DdgRelated);
          }
        } else {
          flatTopics.push(rel);
        }
        if (flatTopics.length >= 5) break;
      }

      const topics = flatTopics.slice(0, 5).map((t) => ({
        text: asString(t.Text).slice(0, 240),
        url: asString(t.FirstURL),
      }));

      // If we have neither an abstract nor topics, tell the LLM plainly.
      // Otherwise the empty shell looks like "success with no info" which
      // burns a tool call without useful signal.
      if (!abstract && !heading && topics.length === 0) {
        return {
          query,
          empty: true,
          hint: 'DDG Instant Answer has no article for this query. Try fetching the company domain directly or search with different wording.',
        };
      }

      return {
        query,
        heading,
        abstract: abstract.slice(0, 800),
        abstractSource: asString(data.AbstractSource),
        abstractURL: asString(data.AbstractURL),
        topics,
        elapsedMs: Date.now() - t0,
      };
    } catch (error) {
      return {
        query,
        error: controller.signal.aborted
          ? `DuckDuckGo search timed out after ${DDG_TIMEOUT_MS}ms`
          : error instanceof Error
            ? error.message
            : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  },
});

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
