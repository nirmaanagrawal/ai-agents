/**
 * convert_currency — live FX rates via open.er-api.com (keyless).
 *
 * The agent calls this whenever an invoice and its matching PO are in
 * different currencies. Critical: we instruct the agent in its system
 * prompt to NEVER estimate FX from memory. Tool always returns either
 * a converted amount + rate, or an `{ error }` envelope.
 *
 * In-memory rate cache (1h TTL) so a batch of 10 invoices doesn't
 * trigger 10 network round-trips.
 */
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 60 * 60 * 1000;

interface CachedRates {
  base: string;
  rates: Record<string, number>;
  fetchedAt: number;
}

let cache: CachedRates | null = null;

async function loadRates(): Promise<CachedRates | { error: string }> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: controller.signal,
    });
    if (!res.ok) return { error: `FX API HTTP ${res.status}` };
    const data = (await res.json()) as {
      result?: string;
      base_code?: string;
      rates?: Record<string, number>;
    };
    if (data.result !== 'success' || !data.rates) {
      return { error: `FX API malformed (result=${data.result})` };
    }
    cache = {
      base: data.base_code ?? 'USD',
      rates: data.rates,
      fetchedAt: Date.now(),
    };
    return cache;
  } catch (e) {
    return {
      error: controller.signal.aborted
        ? `FX API timed out after ${TIMEOUT_MS}ms`
        : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

export const convertCurrencyTool = tool(
  'convert_currency',
  'Convert an amount between two ISO currency codes using live FX rates (open.er-api.com, daily refresh). ALWAYS call this when an invoice and its matched PO are in different currencies — never estimate FX from memory. Returns { amount, converted, rate } or { error }.',
  {
    amount: z.number().describe('Numeric amount; no currency symbols.'),
    from: z.string().length(3).describe('Source ISO code, e.g. "EUR".'),
    to: z.string().length(3).describe('Target ISO code, e.g. "USD".'),
  },
  async ({ amount, from, to }) => {
    const t0 = Date.now();
    const fromU = from.toUpperCase();
    const toU = to.toUpperCase();
    if (fromU === toU) {
      return text({ amount, converted: amount, rate: 1, from: fromU, to: toU, noop: true });
    }
    const rates = await loadRates();
    if ('error' in rates) return text({ error: rates.error, from: fromU, to: toU });
    const fromRate = fromU === rates.base ? 1 : rates.rates[fromU];
    const toRate = toU === rates.base ? 1 : rates.rates[toU];
    if (fromRate == null || toRate == null) {
      return text({
        error: `Unknown currency code(s): ${fromRate == null ? fromU : ''} ${toRate == null ? toU : ''}`.trim(),
        from: fromU,
        to: toU,
      });
    }
    const converted = (amount / fromRate) * toRate;
    const rate = toRate / fromRate;
    return text({
      amount,
      from: fromU,
      converted: Math.round(converted * 100) / 100,
      to: toU,
      rate: Math.round(rate * 100000) / 100000,
      ratesAsOf: new Date(rates.fetchedAt).toISOString(),
      elapsedMs: Date.now() - t0,
    });
  },
);

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}
