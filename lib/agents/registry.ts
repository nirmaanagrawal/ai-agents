/**
 * Central agent registry.
 *
 * Adding an agent = create a new file under lib/agents/ and register it here.
 * Nothing else needs to change — routes and UI are generic over the registry.
 */
import { arCollections } from './ar-collections';
import { churnRisk } from './churn-risk';
import { gccProspector } from './gcc-prospector';
import { invoiceAuditor } from './invoice-auditor';
import { leadQualifier } from './lead-qualifier';
import { outboundCampaign } from './outbound-campaign';
import { resumeScreener } from './resume-screener';
import { salesProposal } from './sales-proposal';
import { vendorEvaluator } from './vendor-evaluator';
import type { AgentConfig } from './types';

// The registry is typed as `AgentConfig<unknown>` at the boundary because
// different agents have different output shapes. Internal modules keep the
// concrete type via the per-agent export.
const agents: Record<string, AgentConfig<unknown>> = {
  [leadQualifier.slug]: leadQualifier as AgentConfig<unknown>,
  [invoiceAuditor.slug]: invoiceAuditor as AgentConfig<unknown>,
  [gccProspector.slug]: gccProspector as AgentConfig<unknown>,
  [vendorEvaluator.slug]: vendorEvaluator as AgentConfig<unknown>,
  [resumeScreener.slug]: resumeScreener as AgentConfig<unknown>,
  [churnRisk.slug]: churnRisk as AgentConfig<unknown>,
  [salesProposal.slug]: salesProposal as AgentConfig<unknown>,
  [arCollections.slug]: arCollections as AgentConfig<unknown>,
  [outboundCampaign.slug]: outboundCampaign as AgentConfig<unknown>,
};

export function getAgent(slug: string): AgentConfig<unknown> | undefined {
  return agents[slug];
}

export function listAgents(): AgentConfig<unknown>[] {
  return Object.values(agents);
}
