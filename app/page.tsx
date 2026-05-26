/**
 * Marketplace home — server component handoff to the sidebar layout.
 *
 * The page itself only loads the agent registry and projects it to
 * public-safe configs. All the interactive bits (selection, URL hash
 * sync, detail panel) live in `MarketplaceLayout`, which is a
 * client component so selection state can drive the UI without a
 * round-trip.
 */
import MarketplaceLayout from '@/components/MarketplaceLayout';
import { listAgents } from '@/lib/agents/registry';
import { toPublicConfig } from '@/lib/agents/types';

export default function MarketplacePage() {
  const agents = listAgents().map(toPublicConfig);
  return <MarketplaceLayout agents={agents} />;
}
