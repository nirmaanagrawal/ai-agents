/**
 * POST /api/agents/[slug]/unlock
 *
 * Body: { sessionId, email, ...gateFields }
 *
 * Exchanges a valid email (and any other required gate fields) for the full
 * stored agent result. Also fires a webhook so the lead lands in your CRM.
 *
 * This is the lead-magnet pivot point:
 *   - The email is the transaction; the report is the payoff.
 *   - We validate the gate fields server-side against the agent's own config
 *     so client tampering can't skip required fields.
 */
import { NextResponse } from 'next/server';
import { getAgent } from '@/lib/agents/registry';
import { redis, sessionKey } from '@/lib/redis';

export const runtime = 'nodejs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface StoredSession {
  slug: string;
  full: unknown;
  teaser: unknown;
  remaining: number;
  gated: boolean;
  /** Flat tool-call trace, surfaced to the UI so the visitor sees
   *  what tools the agent invoked. */
  toolTrace?: unknown;
  /** Per-turn timeline (one entry per assistant turn). Replaces the
   *  earlier workflow-step trace. */
  turnTrace?: unknown;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const agent = getAgent(slug);
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  }

  // --- Validate required gate fields from the agent config -----------------
  // We re-check here (not just on the client) so a scripted POST can't bypass
  // the form. The agent config is the single source of truth.
  for (const field of agent.gate.fields) {
    if (!field.required) continue;
    const value = body[field.name];
    if (typeof value !== 'string' || value.trim() === '') {
      return NextResponse.json(
        { error: `Missing required field: ${field.label}` },
        { status: 400 },
      );
    }
    if (field.type === 'email' && !EMAIL_RE.test(value)) {
      return NextResponse.json(
        { error: 'Invalid email address' },
        { status: 400 },
      );
    }
  }

  // --- Fetch the stored session -------------------------------------------
  const raw = await redis.get<StoredSession | string>(sessionKey(sessionId));
  if (!raw) {
    return NextResponse.json(
      { error: 'Session expired or not found. Please re-run the agent.' },
      { status: 410 },
    );
  }

  // Upstash auto-deserializes JSON when it parses, but older SDK versions
  // return raw strings — handle both.
  const session: StoredSession =
    typeof raw === 'string' ? JSON.parse(raw) : raw;

  // Cross-check the slug: a session started on agent A can't be unlocked
  // through agent B's route.
  if (session.slug !== slug) {
    return NextResponse.json(
      { error: 'Session does not match this agent' },
      { status: 400 },
    );
  }

  // --- Fire the lead webhook (best-effort, non-blocking) ------------------
  // If the CRM is down we don't want to refuse the user their report —
  // log the failure and move on.
  const webhookUrl = process.env.LEAD_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentSlug: slug,
          agentName: agent.name,
          submittedAt: new Date().toISOString(),
          ...body,
        }),
      });
    } catch (error) {
      console.error(`[${slug}] lead webhook failed:`, error);
    }
  }

  // --- Return the full result + traces -----------------------------------
  // Both traces (flat tool calls and per-turn timeline) are part of the
  // unlocked experience — the visitor traded an email to see the agent's
  // full reasoning trail.
  return NextResponse.json({
    unlocked: true,
    toolTrace: session.toolTrace ?? [],
    turnTrace: session.turnTrace ?? [],
    result: session.full,
  });
}
