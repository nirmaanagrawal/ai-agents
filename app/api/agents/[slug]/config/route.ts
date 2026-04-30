/**
 * GET /api/agents/[slug]/config
 *
 * Returns the public-safe subset of the agent config (name, accepted files,
 * gate copy — everything the AgentCard needs to render). Prompts and schemas
 * are deliberately NOT included: there's no reason to ship them to the
 * browser, and keeping them server-only makes scraping the prompt harder.
 */
import { NextResponse } from 'next/server';
import { getAgent } from '@/lib/agents/registry';
import { toPublicConfig } from '@/lib/agents/types';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  // Next.js 15 made route params async — await them.
  const { slug } = await params;
  const agent = getAgent(slug);

  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  }

  return NextResponse.json(toPublicConfig(agent), {
    // Agent configs are static — cache them aggressively at the edge.
    headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=3600' },
  });
}
