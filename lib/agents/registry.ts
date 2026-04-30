/**
 * Central agent registry.
 *
 * Adding an agent = create a new file under lib/agents/ and register it here.
 * Nothing else needs to change — routes and UI are generic over the registry.
 */
import { invoiceAuditor } from './invoice-auditor';
import { leadQualifier } from './lead-qualifier';
import type { AgentConfig } from './types';

// The registry is typed as `AgentConfig<unknown>` at the boundary because
// different agents have different output shapes. Internal modules keep the
// concrete type via the per-agent export.
const agents: Record<string, AgentConfig<unknown>> = {
  [leadQualifier.slug]: leadQualifier as AgentConfig<unknown>,
  [invoiceAuditor.slug]: invoiceAuditor as AgentConfig<unknown>,
};

export function getAgent(slug: string): AgentConfig<unknown> | undefined {
  return agents[slug];
}

export function listAgents(): AgentConfig<unknown>[] {
  return Object.values(agents);
}
