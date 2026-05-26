/**
 * Per-agent chat page.
 *
 * Visitors land here from the marketplace grid (or via direct link).
 * The chat is locked to this specific agent: no dropdown, just a
 * "Back to marketplace" link in the header so visitors who want a
 * different agent navigate back to the grid (which is the canonical
 * picker now).
 *
 * Returns 404 when the slug isn't registered. Pre-rendered at build
 * time via `generateStaticParams` so each agent's page is static + fast.
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

  // Pass only the locked agent in the array — the chat hides the
  // switcher when locked, but the prop shape stays the same so we
  // don't fork the component for one-agent vs many-agent mode.
  const allAgents = listAgents().map(toPublicConfig);
  const lockedAgent = allAgents.find((a) => a.slug === slug);
  if (!lockedAgent) notFound();

  return (
    <AgentChat
      agents={[lockedAgent]}
      initialAgentSlug={slug}
      lockedToAgent
    />
  );
}

export async function generateStaticParams() {
  return listAgents().map((agent) => ({ slug: agent.slug }));
}
