/**
 * check_india_hiring — India-location-aware careers-page probe.
 *
 * Why a separate tool (vs reusing check_hiring_intent):
 *   For GCC prospecting the question isn't "is this company hiring
 *   engineers anywhere" but "is this company hiring engineers IN
 *   INDIA." A generic engineering-keyword count doesn't answer that —
 *   a US-only company can have 50 engineering postings and zero
 *   India-based ones.
 *
 * Approach:
 *   1. Probe the same careers-page paths as check_hiring_intent.
 *   2. For each page that loads, count co-occurrences of an
 *      engineering-role phrase AND an India-location signal in the
 *      same vicinity (we use a sliding window of 200 chars).
 *   3. Return a per-city breakdown plus sample role+location matches.
 *
 * Approximation, not ground truth: this tool can't read ATS-embedded
 * iframes (Greenhouse, Lever) and over-counts pages that mention India
 * cities in non-job contexts. Treat the count as a fuzzy intensity
 * signal, not a precise headcount. The agent's job is to combine this
 * with brave_search results and fetch_webpage content for confidence.
 */
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { lookup } from 'dns/promises';
import { z } from 'zod';

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 250 * 1024;

const CAREERS_PATHS = [
  '/careers',
  '/jobs',
  '/careers/all',
  '/jobs/all',
  '/work-with-us',
  '/join-us',
  '/team',
  '/about/careers',
  '/india',
  '/locations/india',
  '/careers/india',
];

/** Engineering role keywords. Same intent as check_hiring_intent but
 *  scoped narrower — we only care about co-occurrences with India. */
const ENGINEERING_KEYWORDS = [
  'software engineer',
  'software developer',
  'frontend engineer',
  'backend engineer',
  'fullstack engineer',
  'full-stack engineer',
  'platform engineer',
  'infrastructure engineer',
  'devops engineer',
  'site reliability',
  'sre',
  'ml engineer',
  'machine learning engineer',
  'ai engineer',
  'data engineer',
  'data scientist',
  'mobile engineer',
  'ios engineer',
  'android engineer',
  'staff engineer',
  'principal engineer',
  'senior engineer',
  'engineering manager',
  'tech lead',
  'qa engineer',
  'sdet',
];

/** India location signals. Lowercase + word-boundary matched.
 *  Order matters for the per-city breakdown (most specific first). */
const INDIA_CITIES: Array<{ key: string; patterns: string[] }> = [
  { key: 'Bangalore', patterns: ['bangalore', 'bengaluru', 'bglr'] },
  { key: 'Hyderabad', patterns: ['hyderabad', 'hyd'] },
  { key: 'Pune', patterns: ['pune'] },
  { key: 'Chennai', patterns: ['chennai', 'madras'] },
  { key: 'Gurgaon', patterns: ['gurgaon', 'gurugram'] },
  { key: 'Noida', patterns: ['noida'] },
  { key: 'Mumbai', patterns: ['mumbai', 'bombay'] },
  { key: 'Delhi', patterns: ['new delhi', 'delhi ncr'] },
  { key: 'Kolkata', patterns: ['kolkata', 'calcutta'] },
  { key: 'Ahmedabad', patterns: ['ahmedabad'] },
];
const INDIA_GENERIC = ['india', 'south asia']; // catch-alls when no city is named

function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const [a, b] = ip.split('.').map((p) => parseInt(p, 10));
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a >= 224) return true;
    return false;
  }
  return ip.toLowerCase().match(/^(::1|::|fe80|fc|fd|ff)/) !== null;
}

async function isFetchable(domain: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const cleaned = domain.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(cleaned)) return { ok: false, reason: 'IP literals not allowed' };
  if (cleaned === 'localhost' || cleaned.endsWith('.local') || cleaned.endsWith('.internal')) {
    return { ok: false, reason: 'internal hostname' };
  }
  if (!cleaned.includes('.')) return { ok: false, reason: 'must be a fully-qualified domain' };
  try {
    const { address } = await lookup(cleaned);
    if (isPrivateIp(address)) return { ok: false, reason: 'resolves to private IP' };
  } catch (e) {
    return { ok: false, reason: `DNS failed: ${String(e)}` };
  }
  return { ok: true };
}

async function fetchText(url: string, signal: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'BeanbagAgentBot/1.0 (+gcc-prospector)',
        Accept: 'text/html,text/plain',
      },
    });
    if (!res.ok) return null;
    const ctype = res.headers.get('content-type') ?? '';
    if (!ctype.includes('text/html') && !ctype.includes('text/plain')) return null;
    const reader = res.body?.getReader();
    if (!reader) return await res.text();
    const decoder = new TextDecoder();
    let total = 0;
    let out = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        break;
      }
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
    return out;
  } catch {
    return null;
  }
}

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Find role+location co-occurrences using a sliding window. A job
 * posting typically has the role + location within ~150 chars of each
 * other ("Software Engineer · Bangalore" or "Bangalore · Senior
 * Engineer"). 200-char window is generous but rarely produces false
 * matches between unrelated mentions.
 */
function findIndiaRolePairs(text: string): {
  byCity: Record<string, number>;
  total: number;
  genericIndia: number;
  sampleSnippets: string[];
} {
  const byCity: Record<string, number> = {};
  let total = 0;
  let genericIndia = 0;
  const sampleSnippets: string[] = [];

  for (const role of ENGINEERING_KEYWORDS) {
    const roleRe = new RegExp(`\\b${role.replace(/\s+/g, '\\s+')}\\b`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = roleRe.exec(text)) !== null) {
      const start = Math.max(0, m.index - 150);
      const end = Math.min(text.length, m.index + role.length + 150);
      const window = text.slice(start, end);

      let cityMatched: string | null = null;
      for (const city of INDIA_CITIES) {
        for (const p of city.patterns) {
          if (new RegExp(`\\b${p}\\b`, 'i').test(window)) {
            cityMatched = city.key;
            break;
          }
        }
        if (cityMatched) break;
      }

      if (cityMatched) {
        byCity[cityMatched] = (byCity[cityMatched] ?? 0) + 1;
        total++;
        if (sampleSnippets.length < 5) {
          // Trim the snippet and tidy whitespace for the trace.
          sampleSnippets.push(window.replace(/\s+/g, ' ').trim().slice(0, 200));
        }
      } else {
        // No specific city but maybe a "Hiring in India" generic line.
        for (const p of INDIA_GENERIC) {
          if (new RegExp(`\\b${p}\\b`, 'i').test(window)) {
            genericIndia++;
            total++;
            break;
          }
        }
      }
    }
  }

  return { byCity, total, genericIndia, sampleSnippets };
}

export const checkIndiaHiringTool = tool(
  'check_india_hiring',
  'Probe a company\'s careers pages for engineering jobs LOCATED IN INDIA. This is the core GCC-prospect signal: a company that posts engineering roles in Bangalore / Hyderabad / Pune / Chennai / Gurgaon / Noida / Mumbai etc. is operating a GCC there. Returns per-city counts of role+location co-occurrences plus sample snippets. Treat counts as a fuzzy intensity signal (the tool can\'t see ATS iframes); confidence rises sharply with counts ≥ 3 in at least one city.',
  {
    domain: z
      .string()
      .min(3)
      .describe('Company domain only — no protocol. e.g. "stripe.com" or "acme.io".'),
  },
  async ({ domain }) => {
    const ok = await isFetchable(domain);
    if (!ok.ok) return text({ domain, found: false, error: ok.reason });

    const cleaned = domain.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      // Aggregate hits across multiple careers paths in case the
      // company splits global vs India listings.
      let aggregateByCity: Record<string, number> = {};
      let aggregateTotal = 0;
      let aggregateGeneric = 0;
      const sampleSnippets: string[] = [];
      const triedUrls: string[] = [];
      const hitUrls: string[] = [];

      for (const path of CAREERS_PATHS) {
        if (controller.signal.aborted) break;
        const url = `https://${cleaned}${path}`;
        triedUrls.push(url);
        const html = await fetchText(url, controller.signal);
        if (!html) continue;
        const text2 = visibleText(html);
        if (text2.length < 500) continue;
        const r = findIndiaRolePairs(text2);
        if (r.total === 0) continue;
        hitUrls.push(url);
        aggregateTotal += r.total;
        aggregateGeneric += r.genericIndia;
        for (const [city, n] of Object.entries(r.byCity)) {
          aggregateByCity[city] = (aggregateByCity[city] ?? 0) + n;
        }
        for (const s of r.sampleSnippets) {
          if (sampleSnippets.length < 5 && !sampleSnippets.includes(s)) {
            sampleSnippets.push(s);
          }
        }
      }

      if (aggregateTotal === 0) {
        return text({
          domain: cleaned,
          found: false,
          reason:
            'No India-located engineering roles detected on the careers pages we could read. Could mean: (a) company has no India presence, (b) jobs are inside a JS-rendered ATS embed (Greenhouse / Lever) that we can\'t read, or (c) careers page lives at a non-standard URL. Try brave_search for "{company} India engineering" as a follow-up.',
          triedUrls,
        });
      }

      // Rank cities by count for the agent's reasoning.
      const cityRanking = Object.entries(aggregateByCity)
        .sort(([, a], [, b]) => b - a)
        .map(([city, count]) => ({ city, count }));

      return text({
        domain: cleaned,
        found: true,
        totalIndiaRolePairs: aggregateTotal,
        byCity: cityRanking,
        genericIndiaMentions: aggregateGeneric,
        sampleSnippets,
        careersUrlsWithHits: hitUrls,
      });
    } catch (e) {
      return text({
        domain: cleaned,
        found: false,
        error: controller.signal.aborted ? `timed out after ${TIMEOUT_MS}ms` : String(e),
      });
    } finally {
      clearTimeout(timer);
    }
  },
);

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}
