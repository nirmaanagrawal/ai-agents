/**
 * Per-agent deep-link page.
 *
 * Renders the same chat surface as `/`, but with the dropdown
 * pre-selected to the URL slug. Lets us preserve shareable links
 * (e.g. `/agents/lead-qualifier`) and embeddable URLs without a
 * second UI to maintain.
 *
 * Returns 404 when the slug isn't registered. Pre-rendered at build
 * time via `generateStaticParams` so each agent's landing page is
 * static + fast.
 */
import { notFound } from 'next/navigation';
import AgentChat from '@/components/AgentChat';
import { getAgent, listAgents } from '@/lib/agents/registry';
import { toPublicConfig } from '@/lib/agents/types';

export default async function AgentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!getAgent(slug)) notFound();

  const agents = listAgents().map(toPublicConfig);
  return <AgentChat agents={agents} initialAgentSlug={slug} />;
}

export async function generateStaticParams() {
  return listAgents().map((agent) => ({ slug: agent.slug }));
}
