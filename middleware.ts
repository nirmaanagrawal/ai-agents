/**
 * Edge middleware — rate-limits the expensive endpoints before they hit Node.
 *
 * We only protect /api/agents/[slug]/process and /unlock. The /config route
 * is static and cheap; rate-limiting it would just add latency.
 *
 * Upstash Ratelimit is safe to call from the Edge runtime: it speaks HTTP
 * (not a TCP connection), so it works inside Vercel Edge Middleware.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { processRateLimit } from './lib/redis';

/**
 * Race the rate-limit call against a short timeout. If Upstash is slow or
 * misconfigured we'd rather let the request through than have the entire
 * app hang at the edge. Abuse protection is best-effort — the route itself
 * has its own timeouts downstream.
 */
const RATE_LIMIT_TIMEOUT_MS = 2_000;

export async function middleware(request: NextRequest) {
  // Prefer the first IP in X-Forwarded-For (the real client). Vercel sets
  // this; `request.ip` is populated only in some environments.
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const ip = forwarded.split(',')[0]?.trim() || 'anonymous';

  let result;
  try {
    result = await Promise.race([
      processRateLimit.limit(ip),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('rate-limit-timeout')),
          RATE_LIMIT_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (error) {
    console.error('[middleware] rate limit check failed, allowing request:', error);
    return NextResponse.next();
  }

  const { success, limit, remaining, reset } = result;

  if (!success) {
    return new NextResponse(
      JSON.stringify({
        error: 'Too many requests',
        detail: 'Slow down — this marketplace is free and we rate-limit abuse.',
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': String(limit),
          'X-RateLimit-Remaining': String(remaining),
          'X-RateLimit-Reset': String(reset),
          'Retry-After': String(Math.max(1, Math.ceil((reset - Date.now()) / 1000))),
        },
      },
    );
  }

  return NextResponse.next();
}

export const config = {
  // Only rate-limit the expensive routes. Listing both paths explicitly is
  // clearer than matching with a regex.
  matcher: [
    '/api/agents/:slug/process',
    '/api/agents/:slug/unlock',
  ],
};
