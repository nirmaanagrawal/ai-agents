/**
 * fetchWebpage — SSRF-guarded public URL fetcher for company enrichment.
 *
 * The LLM is instructed with visitor-supplied data (a CSV can contain
 * arbitrary "domain" values). Without guards, an attacker could trick the
 * agent into fetching http://169.254.169.254 (AWS metadata), http://localhost,
 * or internal corporate hosts. This tool locks that down:
 *
 *   1. Scheme:   https only (no http, file, ftp, data, …)
 *   2. Hostname: must be a valid public-looking DNS name — rejects IP
 *                literals, "localhost", and .local/.internal suffixes
 *   3. DNS:      resolve and bail if it points at a private/loopback/
 *                link-local range (defense in depth vs. DNS rebinding)
 *   4. Size:     response body capped at MAX_BYTES; we stop reading once
 *                exceeded rather than buffering the whole payload
 *   5. Time:     aborted at FETCH_TIMEOUT_MS
 *   6. Content:  text/html and text/plain only; we strip scripts/styles
 *                and return visible text
 *
 * Even with these guards, treat the fetched text as untrusted — it's web
 * content. We never eval it; we only pass its plain text back to the LLM.
 */
import { tool } from 'ai';
import { lookup } from 'dns/promises';
import { z } from 'zod';

const FETCH_TIMEOUT_MS = 7_000;
const MAX_BYTES = 200 * 1024; // 200 KB of HTML → plenty for title + meta
const MAX_TEXT_CHARS = 6_000; // what we return to the LLM after text extraction

// RFC 1918 + loopback + link-local + ULA. If the DNS lookup resolves here,
// refuse. Not exhaustive (IPv4-mapped IPv6 etc.) but covers the common bad
// cases plus AWS/GCP metadata endpoints.
function isPrivateIp(ip: string): boolean {
  if (!ip) return true;

  // IPv4
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
    const [a, b] = parts;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 (AWS/GCP metadata!)
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  // IPv6 — be strict. Loopback, link-local, unique-local, documentation.
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80:')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
  if (lower.startsWith('ff')) return true; // multicast
  return false;
}

async function validateUrl(input: string): Promise<URL | { error: string }> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { error: 'Invalid URL' };
  }

  if (url.protocol !== 'https:') {
    return { error: 'Only https:// URLs are allowed' };
  }

  const host = url.hostname;
  // Reject IP literals outright — the legitimate use case is looking up a
  // company by its domain name. Anyone passing raw IPs is probing.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) {
    return { error: 'IP address hosts are not allowed' };
  }
  if (host === 'localhost') {
    return { error: 'localhost is not allowed' };
  }
  if (host.endsWith('.local') || host.endsWith('.internal')) {
    return { error: 'Internal TLDs are not allowed' };
  }
  // Must have at least one dot (rules out bare "intranet" style names).
  if (!host.includes('.')) {
    return { error: 'Hostname must be a fully qualified public domain' };
  }

  // DNS check — defense against a public-looking name that resolves to
  // a private network via DNS rebinding.
  try {
    const { address } = await lookup(host);
    if (isPrivateIp(address)) {
      return { error: 'Hostname resolves to a private/internal IP' };
    }
  } catch (error) {
    return {
      error: `DNS lookup failed for ${host}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return url;
}

/**
 * Stream-read the body up to MAX_BYTES, then abort. Prevents a malicious
 * server from serving a multi-GB response and exhausting memory.
 */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    // Fallback: use text() with a content-length check
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_BYTES) throw new Error(`Response too large (${len} bytes)`);
    return await res.text();
  }

  const decoder = new TextDecoder();
  let total = 0;
  let out = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      break; // soft-truncate; what we have is enough for title+meta
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode(); // flush
  return out;
}

/**
 * Reduce HTML to the bits an LLM can use: title, meta description, and
 * visible body text. We're not building a scraper library — good enough
 * is fine. The LLM is robust to messy text.
 */
function htmlToReadable(html: string): {
  title: string;
  description: string;
  text: string;
} {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch = html.match(
    /<meta\s+[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']+)/i,
  );
  const ogDescMatch = html.match(
    /<meta\s+[^>]*property\s*=\s*["']og:description["'][^>]*content\s*=\s*["']([^"']+)/i,
  );

  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    title: (titleMatch?.[1] ?? '').trim().slice(0, 200),
    description: (descMatch?.[1] ?? ogDescMatch?.[1] ?? '').trim().slice(0, 400),
    text: stripped.slice(0, MAX_TEXT_CHARS),
  };
}

export const fetchWebpage = tool({
  description:
    'Fetch a public HTTPS webpage and return its title, meta description, and visible text. ' +
    'Use to enrich a lead when DuckDuckGo search returned nothing — fetching https://{company-domain} ' +
    "typically yields the company's own description of what they do. " +
    'Only public HTTPS URLs allowed; private/internal hosts are blocked. Returns {error} on failure.',
  parameters: z.object({
    url: z
      .string()
      .url()
      .describe(
        'Full https:// URL to fetch, e.g. "https://stripe.com" or "https://acme.com/about". ' +
          'Must be a public domain. Do not pass IP addresses, localhost, or private hosts.',
      ),
  }),
  execute: async ({ url: input }) => {
    const t0 = Date.now();
    const validated = await validateUrl(input);
    if ('error' in validated) {
      return { url: input, error: validated.error };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(validated.toString(), {
        signal: controller.signal,
        redirect: 'follow', // follow redirects but original host was already validated
        headers: {
          // Some sites return degraded content without a UA. Identifying
          // ourselves honestly is better than masquerading.
          'User-Agent': 'AgentMarketplaceBot/1.0 (+enrichment)',
          Accept: 'text/html,text/plain',
        },
      });

      if (!res.ok) {
        return { url: input, error: `HTTP ${res.status} ${res.statusText}` };
      }

      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
        return { url: input, error: `Unsupported content-type: ${contentType}` };
      }

      const body = await readCapped(res);
      const extracted = htmlToReadable(body);

      return {
        url: input,
        finalUrl: res.url,
        title: extracted.title,
        description: extracted.description,
        text: extracted.text,
        bytes: body.length,
        elapsedMs: Date.now() - t0,
      };
    } catch (error) {
      return {
        url: input,
        error: controller.signal.aborted
          ? `Fetch timed out after ${FETCH_TIMEOUT_MS}ms`
          : error instanceof Error
            ? error.message
            : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  },
});
