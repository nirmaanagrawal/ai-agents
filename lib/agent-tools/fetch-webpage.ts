/**
 * fetch_webpage — SSRF-guarded URL fetcher for company enrichment.
 *
 * Same posture as our previous version: only public HTTPS, no IP literals,
 * no localhost / .local, DNS-resolved IP must not be in private/loopback/
 * link-local ranges. Output is title + meta description + visible text,
 * stripped of scripts/styles, capped at MAX_TEXT_CHARS.
 *
 * Treat fetched content as untrusted — never eval, never execute, never
 * use it in a SQL/HTTP request without escaping. We only pass plain text
 * back to the agent.
 */
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { lookup } from 'dns/promises';
import { z } from 'zod';

const TIMEOUT_MS = 7_000;
const MAX_BYTES = 200 * 1024;
const MAX_TEXT_CHARS = 6_000;

function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    if (parts.some((p) => Number.isNaN(p))) return true;
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // AWS/GCP metadata!
    if (a >= 224) return true;
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80:')) return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('ff')) return true;
  return false;
}

async function validateUrl(input: string): Promise<URL | { error: string }> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { error: 'Invalid URL' };
  }
  if (url.protocol !== 'https:') return { error: 'Only https:// URLs allowed' };
  const host = url.hostname;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) {
    return { error: 'IP-address hosts not allowed' };
  }
  if (host === 'localhost') return { error: 'localhost not allowed' };
  if (host.endsWith('.local') || host.endsWith('.internal')) {
    return { error: 'Internal TLDs not allowed' };
  }
  if (!host.includes('.')) return { error: 'Hostname must be a fully-qualified public domain' };
  try {
    const { address } = await lookup(host);
    if (isPrivateIp(address)) return { error: 'Hostname resolves to a private/internal IP' };
  } catch (e) {
    return { error: `DNS lookup failed: ${String(e)}` };
  }
  return url;
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
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
      break;
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

function htmlToReadable(html: string) {
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

export const fetchWebpageTool = tool(
  'fetch_webpage',
  'Fetch a public https:// webpage and return its title + meta description + visible text. Use to enrich a lead by reading their company website (https://{domain}). Only public HTTPS URLs allowed; IP literals, localhost, and private hosts are blocked.',
  {
    url: z
      .string()
      .url()
      .describe(
        'Full https:// URL, e.g. "https://stripe.com" or "https://acme.com/about". Must be a public domain — no IPs, no localhost.',
      ),
  },
  async ({ url: input }) => {
    const t0 = Date.now();
    const validated = await validateUrl(input);
    if ('error' in validated) {
      return text({ url: input, error: validated.error });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(validated.toString(), {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'BeanbagAgentBot/1.0 (+enrichment)',
          Accept: 'text/html,text/plain',
        },
      });
      if (!res.ok) return text({ url: input, error: `HTTP ${res.status}` });
      const ctype = res.headers.get('content-type') ?? '';
      if (!ctype.includes('text/html') && !ctype.includes('text/plain')) {
        return text({ url: input, error: `Unsupported content-type: ${ctype}` });
      }
      const body = await readCapped(res);
      const extracted = htmlToReadable(body);
      return text({
        url: input,
        finalUrl: res.url,
        title: extracted.title,
        description: extracted.description,
        text: extracted.text,
        bytes: body.length,
        elapsedMs: Date.now() - t0,
      });
    } catch (e) {
      return text({
        url: input,
        error: controller.signal.aborted
          ? `Fetch timed out after ${TIMEOUT_MS}ms`
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
