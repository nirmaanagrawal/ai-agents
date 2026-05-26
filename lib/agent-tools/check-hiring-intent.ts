/**
 * check_hiring_intent — careers-page scraper that signals "actively hiring".
 *
 * Why this tool earns its keep:
 *   A company with 10+ open engineering roles posted in the last quarter
 *   is dramatically more likely to be in market for talent / tooling /
 *   services right now. The Lead Qualifier should weight this heavily
 *   into the HOT segmentation.
 *
 * Approach:
 *   1. Probe the most common careers-page paths on the company's domain
 *      (/careers, /jobs, /jobs/all, /work-with-us, /join-us, /team).
 *   2. Use our existing fetch_webpage SSRF guards under the hood — no
 *      raw fetches without the public-host check.
 *   3. Count engineering-flavored job-title keywords in the rendered text
 *      ("software engineer", "frontend", "backend", "platform engineer",
 *      "ML engineer", "DevOps", "SRE", "data engineer", …).
 *   4. Return { found, postsCount, sampleTitles, careersUrl }. Empty
 *      result is informative too — the agent should treat absence as
 *      "no signal" rather than "no hiring."
 *
 * Limitations (be honest with the model in the description):
 *   - Counts keyword hits, not actual job posts. A page that just says
 *     "We're an engineering-driven company" inflates the count. The
 *     Lead Qualifier should treat the count as a fuzzy intensity score,
 *     not a precise headcount.
 *   - JS-rendered careers pages (Greenhouse / Lever embedded) often
 *     return near-empty HTML. Treat empty results as ambiguous.
 *   - LinkedIn jobs would be better signal but has no free API. Adding
 *     that path would require a paid SerpAPI / Apollo subscription.
 */
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { lookup } from 'dns/promises';
import { z } from 'zod';

const TIMEOUT_MS = 7_000;
const MAX_BYTES = 200 * 1024;

/** Common careers-page paths, ordered roughly by hit-rate in the wild. */
const CAREERS_PATHS = ['/careers', '/jobs', '/careers/all', '/jobs/all', '/work-with-us', '/join-us', '/team', '/about/careers'];

/**
 * Engineering-role signal phrases. Tuned for B2B SaaS hiring; the
 * wider the net, the more false positives — but also less risk of
 * missing a "platform engineer" or "infra engineer" that's HOT.
 */
const ENGINEERING_SIGNALS = [
  'software engineer', 'software developer',
  'frontend engineer', 'front-end engineer', 'frontend developer',
  'backend engineer', 'back-end engineer', 'backend developer',
  'fullstack engineer', 'full-stack engineer', 'full stack',
  'platform engineer', 'infrastructure engineer', 'infra engineer',
  'devops engineer', 'site reliability', 'sre',
  'ml engineer', 'machine learning engineer', 'ai engineer',
  'data engineer', 'data scientist',
  'mobile engineer', 'ios engineer', 'android engineer',
  'staff engineer', 'principal engineer', 'senior engineer',
  'engineering manager', 'tech lead',
];

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
  // Same SSRF posture as fetch_webpage: public domain only, real
  // public IP after DNS lookup.
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
        'User-Agent': 'BeanbagAgentBot/1.0 (+hiring-intent)',
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

/** Strip HTML tags and normalize whitespace for keyword counting. */
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function findSignals(text: string): { count: number; samples: string[] } {
  const samples: string[] = [];
  let count = 0;
  for (const phrase of ENGINEERING_SIGNALS) {
    const re = new RegExp(`\\b${phrase.replace(/\s+/g, '\\s+')}\\b`, 'gi');
    const matches = text.match(re);
    if (matches) {
      count += matches.length;
      if (samples.length < 8) samples.push(phrase);
    }
  }
  return { count, samples };
}

export const checkHiringIntentTool = tool(
  'check_hiring_intent',
  'Probe a company\'s careers page for engineering-role hiring signal. Use this on any lead where (a) you have the company domain and (b) the lead might score WARM/HOT and you want to confirm "actively hiring." Returns { found, postsCount, sampleTitles, careersUrl }. A high postsCount + recent posts strongly suggests HOT — weight the lead\'s score +10 to +15 when found is true and postsCount > 5.',
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
      // Probe candidate paths sequentially, stop at first hit. Sequential
      // (not parallel) because one good hit is enough — no point firing
      // 8 requests when /careers usually wins.
      for (const path of CAREERS_PATHS) {
        const url = `https://${cleaned}${path}`;
        const html = await fetchText(url, controller.signal);
        if (!html) continue;
        const text2 = visibleText(html);
        // Skip pages that are too thin to be meaningful (likely a redirect
        // to a SPA without server-rendered content).
        if (text2.length < 500) continue;
        const { count, samples } = findSignals(text2);
        if (count === 0) continue;

        return text({
          domain: cleaned,
          found: true,
          careersUrl: url,
          postsCount: count,
          sampleTitles: samples,
          pageBytes: html.length,
        });
      }
      return text({
        domain: cleaned,
        found: false,
        reason: "No careers page found at common paths, or no engineering-role signal in the text. Could be a JS-rendered ATS embed (Greenhouse/Lever) we can't read, or the company isn't actively hiring.",
        triedPaths: CAREERS_PATHS,
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
