/**
 * search_web — DuckDuckGo Instant Answer API tool, Agent SDK edition.
 *
 * Same intent as before: give the agent a way to fetch a quick factual
 * abstract about a company / person / event. DDG Instant Answer is
 * narrow (Wikipedia-style entries only) but free and keyless. For
 * long-tail companies the response is `{ empty: true }` — that's the
 * agent's signal to fall back to fetch_webpage.
 *
 * Agent SDK tool shape:
 *   - Defined via `tool(name, description, zodSchema, handler)`
 *   - Handler returns `{ content: [{ type: 'text', text: '...' }] }`
 *   - Errors return the same shape with the error in the text — never
 *     throw, otherwise the whole agent run dies.
 */
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const TIMEOUT_MS = 6_000;

interface DdgResponse {
  Abstract?: unknown;
  AbstractSource?: unknown;
  AbstractURL?: unknown;
  Heading?: unknown;
  RelatedTopics?: unknown;
}

export const searchWebTool = tool(
  'search_web',
  'Search the public web via DuckDuckGo Instant Answer for factual info — what a company does, recent news, public funding events, industry classifications. Works best on well-known entities (Wikipedia-worthy companies, public figures, established brands). Returns an abstract + up to 5 related topics. If the result is `empty`, the entity is too long-tail for DDG — try fetch_webpage on the company domain instead.',
  {
    query: z
      .string()
      .min(2)
      .max(200)
      .describe(
        'Focused query, e.g. "Stripe payments" or "OpenAI Series F funding". Be specific; prefer the exact company name.',
      ),
  },
  async ({ query }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const t0 = Date.now();
    try {
      const url =
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}` +
        `&format=json&no_html=1&skip_disambig=1&t=beanbag-agents`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        return errResult(`DuckDuckGo returned HTTP ${res.status}`, query);
      }
      const data = (await res.json()) as DdgResponse;
      const abstract = asString(data.Abstract);
      const heading = asString(data.Heading);
      const source = asString(data.AbstractSource);

      const rawTopics = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];
      const topics: Array<{ text: string; url: string }> = [];
      for (const t of rawTopics) {
        if (!t || typeof t !== 'object') continue;
        const rec = t as { Text?: unknown; FirstURL?: unknown; Topics?: unknown };
        // DDG sometimes nests another `Topics` array under category-style results.
        if (Array.isArray(rec.Topics)) {
          for (const inner of rec.Topics) {
            if (!inner || typeof inner !== 'object') continue;
            const i = inner as { Text?: unknown; FirstURL?: unknown };
            topics.push({ text: asString(i.Text).slice(0, 240), url: asString(i.FirstURL) });
            if (topics.length >= 5) break;
          }
        } else {
          topics.push({ text: asString(rec.Text).slice(0, 240), url: asString(rec.FirstURL) });
        }
        if (topics.length >= 5) break;
      }

      const result =
        !abstract && !heading && topics.length === 0
          ? {
              query,
              empty: true,
              hint:
                'DDG has no abstract for this query. Try fetch_webpage on the company domain or a narrower query.',
            }
          : {
              query,
              heading,
              abstract: abstract.slice(0, 800),
              source,
              abstractURL: asString(data.AbstractURL),
              topics,
              elapsedMs: Date.now() - t0,
            };

      return okResult(result);
    } catch (error) {
      const aborted = controller.signal.aborted;
      return errResult(
        aborted ? `DDG timed out after ${TIMEOUT_MS}ms` : String(error),
        query,
      );
    } finally {
      clearTimeout(timer);
    }
  },
);

function okResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  };
}
function errResult(message: string, query: string) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: message, query }),
      },
    ],
  };
}
function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
