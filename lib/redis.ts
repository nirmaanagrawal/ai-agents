/**
 * Upstash Redis client + rate limiter.
 *
 * One shared module so routes and middleware don't each instantiate their own
 * client (harmless, but noisy in logs and wastes connections).
 *
 * If the env vars are missing we throw at construction time — better to fail
 * fast during `next dev` than to fail silently inside an API route under load.
 */
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.local.example → .env.local.`,
    );
  }
  return value;
}

export const redis = new Redis({
  url: requireEnv('UPSTASH_REDIS_REST_URL'),
  token: requireEnv('UPSTASH_REDIS_REST_TOKEN'),
});

/**
 * 5 requests per minute per IP on `/api/agents/*`.
 *
 * Why sliding window: bursty but forgiving. Fixed-window would let a visitor
 * hammer the endpoint at the boundary (5 at 59s + 5 at 01s = 10 requests in 2
 * seconds); sliding window spreads the allowance across time.
 *
 * Why 5/min: one file upload is one LLM call. A visitor shouldn't need more
 * than a handful of retries per minute, and anything higher is probably abuse
 * burning OpenAI credits.
 */
export const processRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, '1 m'),
  // Analytics flip on a hit counter in Upstash — useful for abuse debugging.
  analytics: true,
  prefix: 'rl:process',
});

/** Session TTL for stored agent results — 1 hour is enough for a visitor
 *  to submit the email form without re-processing the file. */
export const SESSION_TTL_SECONDS = 60 * 60;

export function sessionKey(sessionId: string): string {
  return `session:${sessionId}`;
}
