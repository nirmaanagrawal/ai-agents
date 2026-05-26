'use client';

/**
 * MarketplaceLayout — sidebar-driven agent browser.
 *
 * Why this shape:
 *   Stacked agent cards put the visitor in scroll-mode immediately
 *   and every agent fights for attention against the next. A
 *   sidebar + detail-panel layout (think Notion templates, Linear,
 *   Vercel templates) lets the visitor see the full lineup at a
 *   glance and dive into one without losing their place.
 *
 * Selection lives in local React state, mirrored to the URL hash
 * so a shared link like `agents.beanbag.ai/#lead-qualifier` lands
 * directly on that agent's detail panel. The clickthrough still
 * navigates to `/agents/[slug]` which renders the chat surface —
 * the detail panel here is a marketing preview, not the agent
 * itself.
 *
 * Design notes:
 *   - No heavy borders on the detail card. Subtle shadow + category
 *     accent strip carry the visual weight instead of a frame.
 *   - Emoji sits next to a serif headline rather than in a big
 *     icon tile — typography leads.
 *   - Asymmetric "What it does / What you need" grid in the detail
 *     panel, not stacked. Easier to scan.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PublicAgentConfig } from '@/lib/agents/types';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

// ---- Per-category palette ---------------------------------------------------

const CATEGORY_LABEL: Record<PublicAgentConfig['category'], string> = {
  sales: 'Sales',
  finance: 'Finance',
  operations: 'Operations',
  hr: 'HR',
  marketing: 'Marketing',
  'customer-success': 'Customer Success',
};
const CATEGORY_DOT: Record<PublicAgentConfig['category'], string> = {
  sales: 'bg-brand-500',
  finance: 'bg-emerald-500',
  operations: 'bg-blue-500',
  hr: 'bg-amber-500',
  marketing: 'bg-violet-500',
  'customer-success': 'bg-teal-500',
};
const CATEGORY_STRIP: Record<PublicAgentConfig['category'], string> = {
  sales: 'from-brand-400 via-brand-500 to-brand-600',
  finance: 'from-emerald-400 via-emerald-500 to-emerald-600',
  operations: 'from-blue-400 via-blue-500 to-blue-600',
  hr: 'from-amber-400 via-amber-500 to-amber-600',
  marketing: 'from-violet-400 via-violet-500 to-violet-600',
  'customer-success': 'from-teal-400 via-teal-500 to-teal-600',
};

// ---- Per-agent marketing content -------------------------------------------
//
// What an agent "does" + "gives back" varies wildly and isn't in
// PublicAgentConfig. Hardcoded here as marketplace-display copy so
// the registry stays focused on runtime config.

interface AgentMarketingContent {
  /** 2-4 short outcome bullets. */
  highlights: string[];
  /** 2-3 chips describing what the agent outputs. */
  outputs: string[];
}

const MARKETING: Record<string, AgentMarketingContent> = {
  'lead-qualifier': {
    highlights: [
      'Scores every lead 0–100 against your ICP',
      'Verifies hiring intent on company careers pages',
      'Generates a paste-ready opener per lead',
    ],
    outputs: ['HOT / WARM / COLD grade', 'Per-lead reasoning', 'Outreach drafts'],
  },
  'invoice-auditor': {
    highlights: [
      'Matches every invoice to a PO and applies your policy',
      'Drafts approval emails + vendor outreach automatically',
      'Spots vendor patterns and recommends policy tweaks',
    ],
    outputs: [
      'Auto-approve / route / reject decisions',
      'Paste-ready emails',
      'Pattern + escalation alerts',
    ],
  },
  'gcc-prospector': {
    highlights: [
      'Discovers under-the-radar GCC prospects from scratch',
      'Verifies India team size on real careers pages',
      'Drafts first-touch outreach citing real signals',
    ],
    outputs: [
      'Verified prospect list with India city + team size',
      'Confidence per prospect',
      'Outreach drafts + follow-ups',
    ],
  },
  'vendor-evaluator': {
    highlights: [
      'Computes per-vendor KPIs from your transaction export',
      'Flags chronic underperformers per your definition',
      'Writes the quarterly review for you',
    ],
    outputs: [
      'Scorecard per vendor',
      'Portfolio health score',
      'Recommended actions',
    ],
  },
  'resume-screener': {
    highlights: [
      'Reads the JD and builds screening questions tailored to it',
      'Ranks every resume with strengths, gaps, and red flags',
      'Drafts personalized interview questions per candidate',
    ],
    outputs: [
      'Shortlist / Review / Polite-no grading',
      'Per-candidate interview prep',
      'Outreach openers',
    ],
  },
  'churn-risk': {
    highlights: [
      'Triages every account against your tiering + signals rubric',
      'Drafts paste-ready retention emails per at-risk account',
      'Surfaces cross-portfolio churn drivers and ARR at risk',
    ],
    outputs: [
      'Ranked at-risk accounts with confidence',
      'Per-account save play + retention email',
      'Portfolio health score + churn drivers',
    ],
  },
  'sales-proposal': {
    highlights: [
      'Reads the brief + your catalog and drafts the full proposal',
      'Quotes line items only from your real pricing — never invents rates',
      'Writes a paste-ready cover email + scores its own win probability',
    ],
    outputs: [
      'Full proposal with pricing table',
      'Cover email + alternative pitch',
      'Win-probability call + follow-up gaps',
    ],
  },
};

const FALLBACK_MARKETING: AgentMarketingContent = {
  highlights: [],
  outputs: [],
};

// ---- Roadmap ---------------------------------------------------------------

const ROADMAP = [
  { icon: '📜', name: 'Contract Reviewer', what: 'Flag risky clauses against your playbook' },
  { icon: '🧠', name: 'CS Health Digest', what: 'Spot at-risk customer accounts weekly' },
  { icon: '💸', name: 'Pricing Analyzer', what: 'Detect leakage + recommend rate changes' },
];

// ---- Component -------------------------------------------------------------

export default function MarketplaceLayout({
  agents,
}: {
  agents: PublicAgentConfig[];
}) {
  // Selection state. `null` shows the welcome / overview panel.
  // Sync with URL hash so deep links work (`/#lead-qualifier`).
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  // Initialize from hash on mount; subscribe to hashchange so back/
  // forward navigation between agents feels native.
  useEffect(() => {
    const readHash = () => {
      const hash = window.location.hash.replace(/^#/, '');
      if (hash && agents.some((a) => a.slug === hash)) {
        setSelectedSlug(hash);
      } else {
        setSelectedSlug(null);
      }
    };
    readHash();
    window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
  }, [agents]);

  const handleSelect = (slug: string | null) => {
    setSelectedSlug(slug);
    if (slug) {
      window.history.replaceState(null, '', `${BASE_PATH}/#${slug}`);
    } else {
      window.history.replaceState(null, '', `${BASE_PATH}/`);
    }
  };

  const selected = selectedSlug
    ? agents.find((a) => a.slug === selectedSlug) ?? null
    : null;

  return (
    <div className="min-h-screen bg-cream-100">
      {/* ---- Slim brand strip ---- */}
      <div className="sticky top-0 z-20 border-b border-cream-200 bg-cream-50/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-3.5">
          <button
            type="button"
            onClick={() => handleSelect(null)}
            className="group flex items-center gap-2.5 outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
            aria-label="Beanbag AI marketplace"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${BASE_PATH}/beanbag-logo.png`}
              alt="Beanbag AI"
              className="h-7 w-7 shrink-0 object-contain transition-transform group-hover:scale-105"
            />
            <span className="text-sm font-semibold tracking-tight text-ink-900 transition-colors group-hover:text-brand-600">
              Beanbag AI
            </span>
            <span className="hidden text-xs text-ink-500 sm:inline">
              · Agent marketplace
            </span>
          </button>
          <a
            href="https://www.beanbag.ai"
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-ink-700 transition-colors hover:text-brand-600"
          >
            Visit www.beanbag.ai ↗
          </a>
        </div>
      </div>

      {/* ---- Two-pane layout ---- */}
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-0 lg:flex-row">
        {/* Sidebar */}
        <Sidebar
          agents={agents}
          selectedSlug={selectedSlug}
          onSelect={handleSelect}
        />

        {/* Detail panel */}
        <main className="flex-1 px-5 py-6 lg:px-10 lg:py-10">
          {selected ? (
            <AgentDetailPanel agent={selected} />
          ) : (
            <WelcomePanel
              agents={agents}
              onSelectAgent={(slug) => handleSelect(slug)}
            />
          )}
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function Sidebar({
  agents,
  selectedSlug,
  onSelect,
}: {
  agents: PublicAgentConfig[];
  selectedSlug: string | null;
  onSelect: (slug: string | null) => void;
}) {
  return (
    <aside className="border-b border-cream-200 bg-cream-50/60 px-4 py-5 lg:sticky lg:top-[57px] lg:h-[calc(100vh-57px)] lg:w-[280px] lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-3 lg:py-6">
      {/* "Welcome" row — selectable to clear selection */}
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={`mb-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
          selectedSlug === null
            ? 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200/60'
            : 'text-ink-700 hover:bg-cream-100 hover:text-ink-900'
        }`}
      >
        <span className="text-base">🏠</span>
        <span>Overview</span>
      </button>

      <SectionHeader>Agents</SectionHeader>
      <nav className="space-y-0.5">
        {agents.map((agent) => (
          <SidebarRow
            key={agent.slug}
            agent={agent}
            active={selectedSlug === agent.slug}
            onClick={() => onSelect(agent.slug)}
          />
        ))}
      </nav>

      <SectionHeader>Roadmap</SectionHeader>
      <ul className="space-y-0.5">
        {ROADMAP.map((r) => (
          <li
            key={r.name}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-500"
            title={r.what}
          >
            <span className="text-base opacity-60">{r.icon}</span>
            <span className="truncate">{r.name}</span>
            <span className="ml-auto text-[10px] uppercase tracking-wider text-ink-300">
              soon
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-8 border-t border-cream-200 pt-4 text-xs text-ink-500 lg:mt-auto">
        <p>
          Built by{' '}
          <a
            href="https://www.beanbag.ai"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-ink-700 transition-colors hover:text-brand-600"
          >
            Beanbag AI
          </a>
          .
        </p>
      </div>
    </aside>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 mt-5 px-3 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
      {children}
    </p>
  );
}

function SidebarRow({
  agent,
  active,
  onClick,
}: {
  agent: PublicAgentConfig;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${
        active
          ? 'bg-brand-50 ring-1 ring-inset ring-brand-200/60'
          : 'hover:bg-cream-100'
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${CATEGORY_DOT[agent.category]}`} />
      <span className="text-base shrink-0">{agent.icon}</span>
      <span
        className={`truncate text-sm font-medium ${
          active ? 'text-ink-900' : 'text-ink-700 group-hover:text-ink-900'
        }`}
      >
        {agent.name}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Welcome panel (no agent selected)
// ---------------------------------------------------------------------------

function WelcomePanel({
  agents,
  onSelectAgent,
}: {
  agents: PublicAgentConfig[];
  onSelectAgent: (slug: string) => void;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-12 py-6">
      {/* Hero */}
      <section className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-20 -top-10 h-72 w-72 rounded-full bg-brand-gradient-soft blur-3xl"
        />
        <div className="relative">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-brand-200/70 bg-white/60 px-3.5 py-1 text-xs font-medium text-brand-700 shadow-sm backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500 shadow-[0_0_8px_rgba(234,99,71,0.7)]" />
            Powered by Claude · live web tools · autonomous workflows
          </div>
          <h1 className="font-serif text-5xl font-bold leading-[1.05] tracking-tight text-ink-900 sm:text-6xl">
            AI agents that{' '}
            <span className="bg-brand-gradient bg-clip-text text-transparent">
              do the work
            </span>
            .
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-700 sm:text-lg">
            Pick an agent from the sidebar. Answer a few questions. Get a
            structured, ready-to-action answer in under a minute — no signup,
            no setup, no glue code.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-ink-500">
            <span>↖ Start with</span>
            {agents.slice(0, 2).map((a) => (
              <button
                key={a.slug}
                type="button"
                onClick={() => onSelectAgent(a.slug)}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-sm font-medium text-ink-900 ring-1 ring-cream-200 transition-all hover:-translate-y-0.5 hover:ring-brand-300 hover:shadow-sm"
              >
                <span>{a.icon}</span>
                <span>{a.name}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-5 font-serif text-2xl font-semibold text-ink-900">
          How it works
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            {
              step: '1',
              title: 'Pick an agent',
              copy: 'Each agent is purpose-built for one job.',
            },
            {
              step: '2',
              title: 'Answer a few questions',
              copy: 'A short MCQ wizard anchors the agent to your context.',
            },
            {
              step: '3',
              title: 'Get a structured answer',
              copy: 'Scored rows, drafts, confidence flags. Built for action.',
            },
          ].map((s) => (
            <div
              key={s.step}
              className="rounded-2xl bg-white p-5 shadow-brand-card"
            >
              <div className="mb-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand-gradient font-serif text-xs font-bold text-white shadow-brand-cta">
                {s.step}
              </div>
              <h3 className="font-serif text-base font-semibold text-ink-900">
                {s.title}
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-700">
                {s.copy}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent detail panel
// ---------------------------------------------------------------------------

function AgentDetailPanel({ agent }: { agent: PublicAgentConfig }) {
  const marketing = MARKETING[agent.slug] ?? FALLBACK_MARKETING;
  const capabilities = deriveCapabilities(agent);

  return (
    <article className="mx-auto max-w-3xl">
      <div className="relative overflow-hidden rounded-3xl bg-white shadow-brand-card">
        {/* Top accent strip — category-colored gradient. Replaces
            the old boxy border treatment. */}
        <div className={`h-1.5 bg-gradient-to-r ${CATEGORY_STRIP[agent.category]}`} />

        <div className="p-8 sm:p-10">
          {/* Header row — emoji + serif title + category dot */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-baseline gap-4">
              <span className="text-4xl leading-none">{agent.icon}</span>
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${CATEGORY_DOT[agent.category]}`}
                  />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                    {CATEGORY_LABEL[agent.category]}
                  </span>
                </div>
                <h1 className="mt-1 font-serif text-3xl font-bold leading-tight text-ink-900 sm:text-4xl">
                  {agent.name}
                </h1>
              </div>
            </div>
          </div>

          <p className="mt-6 text-base leading-relaxed text-ink-700 sm:text-lg">
            {agent.description}
          </p>

          {/* Capability chips */}
          {capabilities.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-1.5">
              {capabilities.map((c) => (
                <span
                  key={c.label}
                  className="inline-flex items-center gap-1 rounded-full bg-cream-100 px-2.5 py-1 text-[11px] font-medium text-ink-700"
                  title={c.tooltip}
                >
                  <span>{c.icon}</span>
                  <span>{c.label}</span>
                </span>
              ))}
            </div>
          )}

          {/* Two-col: What it does + What you need */}
          <div className="mt-8 grid grid-cols-1 gap-8 sm:grid-cols-2">
            {marketing.highlights.length > 0 && (
              <DetailSection title="What it does">
                <ul className="space-y-2">
                  {marketing.highlights.map((h, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm leading-relaxed text-ink-700"
                    >
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-brand-500" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </DetailSection>
            )}

            <DetailSection title="What you bring">
              {agent.fileSlots.length > 0 ? (
                <ul className="space-y-2">
                  {agent.fileSlots.map((slot) => (
                    <li
                      key={slot.key}
                      className="text-sm leading-relaxed text-ink-700"
                    >
                      <span className="font-medium text-ink-900">📎 {slot.label}</span>
                      <span className="ml-1 text-xs text-ink-500">
                        ({slot.extensions.join(', ')})
                      </span>
                      {!slot.required && (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wider text-ink-300">
                          optional
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm leading-relaxed text-ink-700">
                  Nothing to upload — just answer the wizard and the agent
                  takes it from there.
                </p>
              )}
            </DetailSection>
          </div>

          {/* What you get back */}
          {marketing.outputs.length > 0 && (
            <DetailSection title="What you get back" className="mt-8">
              <div className="flex flex-wrap gap-1.5">
                {marketing.outputs.map((o, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 rounded-md bg-cream-100 px-2.5 py-1 text-xs font-medium text-ink-700"
                  >
                    <span className="text-brand-500">→</span>
                    {o}
                  </span>
                ))}
              </div>
            </DetailSection>
          )}

          {/* CTA */}
          <div className="mt-10 flex items-center justify-between border-t border-cream-200 pt-6">
            <p className="text-xs text-ink-500">
              No signup · runs in under a minute · 3-row preview free
            </p>
            <Link
              href={`/agents/${agent.slug}`}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-gradient px-5 py-2.5 text-sm font-semibold text-white shadow-brand-cta transition-all hover:-translate-y-0.5 hover:shadow-brand-cta-hover active:translate-y-0"
            >
              <span>Try this agent</span>
              <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

function DetailSection({
  title,
  children,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
        {title}
      </h2>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Capability derivation
// ---------------------------------------------------------------------------

/**
 * Derive the chip list from the agent's PublicAgentConfig + a small
 * hand-curated map for things the public config doesn't expose
 * (Level-4 status, web-tool use). Cheaper than adding more fields to
 * AgentConfig that the marketplace would be the only consumer of.
 */
function deriveCapabilities(agent: PublicAgentConfig): Array<{
  icon: string;
  label: string;
  tooltip?: string;
}> {
  const caps: Array<{ icon: string; label: string; tooltip?: string }> = [];

  // Wizard
  if (agent.dynamicWizard) {
    caps.push({
      icon: '✨',
      label: 'Dynamic wizard',
      tooltip: 'Questions are built from your uploaded file',
    });
  } else if (AGENTS_WITH_PRESET_WIZARD.has(agent.slug)) {
    caps.push({
      icon: '📋',
      label: 'Guided setup',
      tooltip: 'A short MCQ wizard anchors the agent to your context',
    });
  }

  // Hardcoded knowledge of which agents use web tools + are Level-4.
  if (AGENTS_USING_WEB_TOOLS.has(agent.slug)) {
    caps.push({
      icon: '🌐',
      label: 'Live web tools',
      tooltip: 'Calls real web search + page fetches when needed',
    });
  }
  if (LEVEL_4_AGENTS.has(agent.slug)) {
    caps.push({
      icon: '🤖',
      label: 'Level 4 autonomous',
      tooltip:
        'Plans, self-monitors, drafts the action, and self-reviews before submitting',
    });
  }

  return caps;
}

// Slugs the marketplace knows extra things about. Keep this list
// short and tied to actual properties of the agent — not a registry
// of marketing claims.
const AGENTS_WITH_PRESET_WIZARD = new Set([
  'lead-qualifier',
  'gcc-prospector',
  'vendor-evaluator',
  'churn-risk',
  'sales-proposal',
]);
const AGENTS_USING_WEB_TOOLS = new Set([
  'lead-qualifier',
  'invoice-auditor',
  'gcc-prospector',
  'vendor-evaluator',
  'resume-screener',
  'churn-risk',
  'sales-proposal',
]);
const LEVEL_4_AGENTS = new Set([
  'invoice-auditor',
  'gcc-prospector',
  'churn-risk',
  'sales-proposal',
]);
