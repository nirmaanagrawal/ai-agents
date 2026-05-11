/**
 * Marketplace landing page — grid of agent cards.
 *
 * Replaces the previous "drop the visitor straight into a chat" home
 * page. The grid is the agent picker: visitors see what's available at
 * a glance and click into the specific agent they want. Each card links
 * to `/agents/[slug]` which renders the chat locked to that agent.
 *
 * Server component on purpose — the agent registry is server-side data,
 * and the grid itself is static. No client JS needed at all on this
 * page; the cards are plain `<a>`-styled `<Link>`s.
 */
import Link from 'next/link';
import { listAgents } from '@/lib/agents/registry';
import type { AgentConfig } from '@/lib/agents/types';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Human-readable label per category — keeps the badge consistent. */
const CATEGORY_LABEL: Record<AgentConfig['category'], string> = {
  sales: 'Sales',
  finance: 'Finance',
  operations: 'Operations',
  hr: 'HR',
  marketing: 'Marketing',
};

/** Subtle category-tinting for the badge. Low-saturation so it
 *  harmonizes with the coral brand rather than fighting it. */
const CATEGORY_CHIP: Record<AgentConfig['category'], string> = {
  sales: 'bg-brand-50 text-brand-700 ring-brand-100',
  finance: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  operations: 'bg-blue-50 text-blue-700 ring-blue-100',
  hr: 'bg-amber-50 text-amber-700 ring-amber-100',
  marketing: 'bg-violet-50 text-violet-700 ring-violet-100',
};

export default function MarketplacePage() {
  const agents = listAgents();

  return (
    <main className="min-h-screen bg-cream-100">
      {/* ---- Brand bar (matches the chat page so cross-navigation is
                seamless) ---- */}
      <div className="bg-ink-900">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-6 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${BASE_PATH}/beanbag-logo.png`}
            alt="Beanbag AI"
            className="h-7 w-7 shrink-0 object-contain"
          />
          <span className="text-base font-semibold tracking-tight text-white">
            Beanbag AI
          </span>
          <span className="ml-2 text-xs text-ink-300">Agent marketplace</span>
        </div>
      </div>

      {/* ---- Hero ---- */}
      <section className="border-b border-cream-200 bg-cream-50">
        <div className="mx-auto max-w-3xl px-6 py-14 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-gradient-soft px-3 py-1 text-xs font-medium text-brand-700">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
            Powered by Claude · live web tools · real workflows
          </div>
          <h1 className="font-serif text-4xl font-bold leading-tight text-ink-900 sm:text-5xl">
            AI agents that{' '}
            <span className="bg-brand-gradient bg-clip-text text-transparent">
              do the work
            </span>
            .
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-ink-700">
            Pick an agent below. Drop a file. Get a structured answer in under a
            minute — scored, sourced, and ready to action.
          </p>
        </div>
      </section>

      {/* ---- Agent grid ---- */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-6 flex items-baseline justify-between">
          <h2 className="font-serif text-xl font-semibold text-ink-900">
            Available agents
          </h2>
          <span className="text-sm text-ink-500">
            {agents.length} {agents.length === 1 ? 'agent' : 'agents'}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <Link
              key={agent.slug}
              href={`/agents/${agent.slug}`}
              className="group relative flex flex-col overflow-hidden rounded-2xl border border-cream-200 bg-white p-6 shadow-brand-card transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-brand-cta-hover"
            >
              {/* Top accent strip — appears on hover, mirrors beanbag.ai's
                  ::before coral bar treatment on cards. */}
              <span className="absolute inset-x-0 top-0 h-1 bg-brand-gradient opacity-0 transition-opacity group-hover:opacity-100" />

              <div className="flex items-start justify-between">
                <span className="text-4xl leading-none">{agent.icon}</span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${CATEGORY_CHIP[agent.category]}`}
                >
                  {CATEGORY_LABEL[agent.category]}
                </span>
              </div>

              <h3 className="mt-4 font-serif text-lg font-semibold text-ink-900">
                {agent.name}
              </h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-700">
                {agent.description}
              </p>

              {/* Footer chips: input expectations so visitors see what
                  they need to upload before clicking through. */}
              <div className="mt-4 flex flex-wrap gap-1.5">
                {agent.fileSlots.map((slot) => (
                  <span
                    key={slot.key}
                    className="rounded-md bg-cream-100 px-2 py-0.5 text-[11px] font-medium text-ink-700"
                    title={`${slot.label}: ${slot.extensions.join(', ')}`}
                  >
                    📎 {slot.label}
                  </span>
                ))}
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-cream-200 pt-4 text-sm">
                <span className="text-ink-500">No signup</span>
                <span className="inline-flex items-center gap-1 font-medium text-brand-600 transition-transform group-hover:translate-x-0.5">
                  Try this agent <span aria-hidden>→</span>
                </span>
              </div>
            </Link>
          ))}
        </div>

        {/* "More coming" tile keeps the grid from looking sparse with
            only 2 agents shipping today. */}
        {agents.length < 3 && (
          <div className="mt-5 rounded-2xl border-2 border-dashed border-cream-300 bg-cream-50 p-8 text-center">
            <p className="font-serif text-lg font-semibold text-ink-700">
              More agents shipping soon
            </p>
            <p className="mt-1 text-sm text-ink-500">
              Contract reviewer · Customer-success digest · Pricing analyzer · others in the works.
            </p>
          </div>
        )}
      </section>

      {/* Footer rendered globally via layout.tsx */}
    </main>
  );
}
