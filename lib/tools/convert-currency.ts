/**
 * convertCurrency — live FX rates via open.er-api.com.
 *
 * open.er-api.com (Exchange Rate API) publishes a free tier with no API
 * key: `https://open.er-api.com/v6/latest/USD` returns USD→* rates with
 * daily refresh. We fetch the USD base once per process lifetime, cache
 * in memory, and compute any cross-rate from it (EUR→GBP = USD/EUR ÷ USD/GBP).
 *
 * Why rate-caching matters: the invoice auditor may convert 10+ amounts
 * in one run. Each call without cache is a network round-trip; with cache
 * all after the first are sub-millisecond. TTL is 1 hour — FX doesn't
 * move meaningfully faster than that for audit purposes.
 *
 * Graceful degradation: if the API is unreachable we return {error} so
 * the LLM can flag the invoice for manual review instead of silently
 * using stale data.
 */
import { tool } from 'ai';
import { z } from 'zod';

const FX_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

interface CachedRates {
  base: string;
  rates: Record<string, number>;
  fetchedAt: number;
}

// Process-wide cache. On Vercel this survives warm-invocation boundaries
// within a single lambda instance. Cold starts re-fetch — cheap enough.
let cache: CachedRates | null = null;

async function loadRates(): Promise<CachedRates | { error: string }> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FX_TIMEOUT_MS);
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: controller.signal,
    });
    if (!res.ok) return { error: `FX API returned HTTP ${res.status}` };
    const data = (await res.json()) as {
      result?: string;
      base_code?: string;
      rates?: Record<string, number>;
    };
    if (data.result !== 'success' || !data.rates) {
      return { error: `FX API response malformed (result=${data.result})` };
    }
    cache = {
      base: data.base_code ?? 'USD',
      rates: data.rates,
      fetchedAt: Date.now(),
    };
    return cache;
  } catch (error) {
    return {
      error: controller.signal.aborted
        ? `FX API timed out after ${FX_TIMEOUT_MS}ms`
        : error instanceof Error
          ? error.message
          : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export const convertCurrency = tool({
  description:
    'Convert an amount from one ISO currency code to another using live FX rates (open.er-api.com, daily refresh). ' +
    'Use whenever an invoice and its matching PO are in different currencies — never compare raw numbers across currencies. ' +
    'Returns { amount, converted, rate, base } on success, { error } on failure.',
  parameters: z.object({
    amount: z.number().describe('Numeric amount to convert. No currency symbols.'),
    from: z
      .string()
      .length(3)
      .describe('Source ISO 4217 currency code, e.g. "EUR", "GBP", "JPY".'),
    to: z
      .string()
      .length(3)
      .describe('Target ISO 4217 currency code, e.g. "USD".'),
  }),
  execute: async ({ amount, from, to }) => {
    const t0 = Date.now();
    const fromU = from.toUpperCase();
    const toU = to.toUpperCase();

    if (fromU === toU) {
      return { amount, converted: amount, rate: 1, from: fromU, to: toU, noop: true };
    }

    const rates = await loadRates();
    if ('error' in rates) {
      return { error: rates.error, from: fromU, to: toU };
    }

    const fromRate = fromU === rates.base ? 1 : rates.rates[fromU];
    const toRate = toU === rates.base ? 1 : rates.rates[toU];
    if (fromRate == null || toRate == null) {
      return {
        error: `Unknown currency code(s). ${fromRate == null ? fromU + ' not in rate table. ' : ''}${toRate == null ? toU + ' not in rate table. ' : ''}`,
        from: fromU,
        to: toU,
      };
    }

    // Cross-rate via USD: amount(from) → USD → target
    const amountInBase = amount / fromRate;
    const converted = amountInBase * toRate;
    const rate = toRate / fromRate;

    return {
      amount,
      from: fromU,
      converted: Math.round(converted * 100) / 100,
      to: toU,
      rate: Math.round(rate * 100000) / 100000,
      ratesAsOf: new Date(rates.fetchedAt).toISOString(),
      elapsedMs: Date.now() - t0,
    };
  },
});
