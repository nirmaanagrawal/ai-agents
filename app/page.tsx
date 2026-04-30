/**
 * Marketplace home — now a chat surface.
 *
 * The page is a server component so it can pull the agent registry without
 * an extra client-side fetch. We project to the public-safe view (strips
 * prompts, schema, internal handlers) and pass it to the client `AgentChat`
 * which renders the dropdown + conversation.
 *
 * Replaces the prior grid-of-cards landing page. Visitors who hit `/`
 * land directly in a chat with the first registered agent; the dropdown
 * lets them switch.
 */
import AgentChat from '@/components/AgentChat';
import { listAgents } from '@/lib/agents/registry';
import { toPublicConfig } from '@/lib/agents/types';

export default function HomePage() {
  const agents = listAgents().map(toPublicConfig);
  return <AgentChat agents={agents} />;
}
