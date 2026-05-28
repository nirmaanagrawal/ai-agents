'use client';

/**
 * MarketplaceLayout — sidebar-driven agent browser.
 *
 * Design pass (Refined warmth):
 *   - Top bar: glass-morphic, brand-marked, with ⌘K and theme toggle
 *     so the marketplace reads "premium product UI", not "static site"
 *   - Sidebar: Linear-style sliding pill marks the active agent —
 *     Framer Motion's `layoutId` does the magic, no manual animation
 *     state to manage
 *   - Detail panel: shadcn Card primitive, Framer Motion entry,
 *     refined type hierarchy. Category accent strip stays for visual
 *     variety across the lineup.
 *   - Welcome panel: more confident hero, animated counter for total
 *     agent count, capability badges in a grid rather than buried
 *
 * Selection lives in local React state, mirrored to the URL hash so
 * `agents.beanbag.ai/#lead-qualifier` deep-links work. The "Try this
 * agent" CTA still navigates to `/agents/[slug]` — the detail panel
 * here is a preview, not the agent runtime.
 *
 * Capability derivation: hand-curated sets at the bottom of this
 * file (preset wizard / web tools / Level-4) — cheaper than adding
 * marketing flags to AgentConfig.
 */
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  ExternalLink,
  FileText,
  Globe,
  ListChecks,
  Search,
  Sparkles,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CommandPalette } from '@/components/CommandPalette';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { PublicAgentConfig } from '@/lib/agents/types';
import { cn } from '@/lib/utils';

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

interface AgentMarketingContent {
  highlights: string[];
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
    outputs: ['Scorecard per vendor', 'Portfolio health score', 'Recommended actions'],
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
  'ar-collections': {
    highlights: [
      'Triages every overdue invoice against your playbook',
      'Drafts paste-ready dunning emails in matching tone per invoice',
      'Surfaces concentration risks + flags strategic accounts to soft-touch',
    ],
    outputs: [
      'Ranked overdue list with confidence',
      'Per-invoice action + dunning email',
      'AR health score + concentration risks',
    ],
  },
};

const FALLBACK_MARKETING: AgentMarketingContent = { highlights: [], outputs: [] };

const ROADMAP = [
  { icon: '📜', name: 'Contract Reviewer', what: 'Flag risky clauses against your playbook' },
  { icon: '✉️', name: 'Outbound Campaign', what: 'Build multi-step sequences from a value-prop' },
  { icon: '💸', name: 'Pricing Analyzer', what: 'Detect leakage + recommend rate changes' },
];

// ---------------------------------------------------------------------------
// Top-level component
// ---------------------------------------------------------------------------

export default function MarketplaceLayout({ agents }: { agents: PublicAgentConfig[] }) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

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
    <div className="min-h-screen bg-background">
      {/* ---- Top bar ---- */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/75 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-3">
          <button
            type="button"
            onClick={() => handleSelect(null)}
            className="group flex items-center gap-2.5 rounded-md outline-none"
            aria-label="Beanbag AI marketplace"
          >
            <Image
              src={`${BASE_PATH}/beanbag-logo.png`}
              alt="Beanbag AI"
              width={28}
              height={28}
              className="h-7 w-7 shrink-0 object-contain transition-transform group-hover:scale-105"
            />
            <span className="text-sm font-semibold tracking-tight text-foreground transition-colors group-hover:text-primary">
              Beanbag AI
            </span>
            <Badge variant="muted" size="sm" className="hidden font-normal sm:inline-flex">
              Agent marketplace
            </Badge>
          </button>

          <div className="flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPaletteOpen(true)}
                  className="h-9 gap-2 text-muted-foreground hover:text-foreground"
                >
                  <Search className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Search agents</span>
                  <kbd className="hidden rounded border border-border bg-muted px-1 text-[10px] font-mono sm:inline">
                    ⌘K
                  </kbd>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open command palette</TooltipContent>
            </Tooltip>
            <ThemeToggle />
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href="https://www.beanbag.ai"
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  beanbag.ai
                  <ExternalLink className="h-3 w-3" />
                </a>
              </TooltipTrigger>
              <TooltipContent>Visit the main Beanbag site</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </header>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        agents={agents}
        onSelect={handleSelect}
      />

      {/* ---- Two-pane layout ---- */}
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-0 lg:flex-row">
        <Sidebar agents={agents} selectedSlug={selectedSlug} onSelect={handleSelect} />

        <main className="flex-1 px-5 py-8 lg:px-12 lg:py-12">
          <AnimatePresence mode="wait">
            {selected ? (
              <motion.div
                key={selected.slug}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              >
                <AgentDetailPanel agent={selected} />
              </motion.div>
            ) : (
              <motion.div
                key="welcome"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              >
                <WelcomePanel agents={agents} onSelectAgent={handleSelect} />
              </motion.div>
            )}
          </AnimatePresence>
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
    <aside className="border-b border-border bg-card/40 px-3 py-5 lg:sticky lg:top-[57px] lg:h-[calc(100vh-57px)] lg:w-[280px] lg:shrink-0 lg:overflow-hidden lg:border-b-0 lg:border-r lg:py-6">
      <ScrollArea className="h-full px-1">
        <LayoutGroup id="sidebar-nav">
          {/* Overview row */}
          <SidebarItem active={selectedSlug === null} onClick={() => onSelect(null)}>
            <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Overview</span>
          </SidebarItem>

          <SectionHeader>Agents · {agents.length}</SectionHeader>
          <nav className="space-y-0.5">
            {agents.map((agent) => (
              <SidebarItem
                key={agent.slug}
                active={selectedSlug === agent.slug}
                onClick={() => onSelect(agent.slug)}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    CATEGORY_DOT[agent.category],
                  )}
                />
                <span className="text-base shrink-0 leading-none">{agent.icon}</span>
                <span className="truncate font-medium">{agent.name}</span>
              </SidebarItem>
            ))}
          </nav>

          <SectionHeader>Roadmap</SectionHeader>
          <ul className="space-y-0.5">
            {ROADMAP.map((r) => (
              <li
                key={r.name}
                className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground"
                title={r.what}
              >
                <span className="text-base opacity-60 leading-none">{r.icon}</span>
                <span className="truncate">{r.name}</span>
                <Badge variant="muted" size="sm" className="ml-auto font-normal">
                  soon
                </Badge>
              </li>
            ))}
          </ul>
        </LayoutGroup>

        <Separator className="my-6" />

        <div className="px-3 pb-2 text-xs text-muted-foreground">
          Built by{' '}
          <a
            href="https://www.beanbag.ai"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground transition-colors hover:text-primary"
          >
            Beanbag AI
          </a>
          .
        </div>
      </ScrollArea>
    </aside>
  );
}

function SidebarItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors',
        active
          ? 'text-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
    >
      {/* Sliding pill — Framer Motion magic. The same `layoutId`
          across items animates the background between them. */}
      {active && (
        <motion.span
          layoutId="sidebar-active-pill"
          className="absolute inset-0 rounded-md bg-accent ring-1 ring-inset ring-primary/20"
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        />
      )}
      <span className="relative z-10 flex flex-1 items-center gap-2.5 truncate">
        {children}
      </span>
    </button>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 mt-6 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
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
    <div className="mx-auto max-w-4xl space-y-16 py-4">
      {/* Hero */}
      <section className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-16 h-80 w-80 rounded-full bg-brand-gradient-soft blur-3xl"
        />
        <div className="relative">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3.5 py-1 text-xs font-medium text-foreground shadow-soft backdrop-blur-sm">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            <span>Powered by Claude</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">Live web tools · Autonomous</span>
          </div>
          <h1 className="font-serif text-5xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-6xl">
            AI agents that{' '}
            <span className="bg-brand-gradient bg-clip-text text-transparent">
              do the work
            </span>
            .
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Pick an agent from the sidebar. Answer a few questions. Get a
            structured, ready-to-action answer in under a minute — no signup,
            no setup, no glue code.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-2.5">
            <span className="mr-1 text-sm text-muted-foreground">Start with</span>
            {agents.slice(0, 3).map((a) => (
              <motion.button
                key={a.slug}
                type="button"
                onClick={() => onSelectAgent(a.slug)}
                whileHover={{ y: -2 }}
                transition={{ duration: 0.15 }}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm font-medium text-foreground shadow-soft transition-shadow hover:shadow-soft-lg"
              >
                <span>{a.icon}</span>
                <span>{a.name}</span>
              </motion.button>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Autonomous agents" value={agents.length} />
        <StatTile label="Categories covered" value={uniqueCount(agents.map((a) => a.category))} />
        <StatTile label="Level-4 autonomy" value={agents.filter((a) => LEVEL_4_AGENTS.has(a.slug)).length} />
        <StatTile label="Web-tool enabled" value={agents.filter((a) => AGENTS_USING_WEB_TOOLS.has(a.slug)).length} />
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-6 font-serif text-2xl font-semibold text-foreground">
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
          ].map((s, i) => (
            <motion.div
              key={s.step}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.05 * i, ease: [0.16, 1, 0.3, 1] }}
            >
              <Card className="h-full transition-shadow hover:shadow-soft-lg">
                <CardContent className="p-5">
                  <div className="mb-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand-gradient font-serif text-xs font-bold text-white shadow-brand-cta">
                    {s.step}
                  </div>
                  <h3 className="font-serif text-base font-semibold text-foreground">
                    {s.title}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {s.copy}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <Card className="border-border/60 bg-card/40">
      <CardContent className="p-4">
        <p className="font-serif text-3xl font-bold text-foreground">
          <AnimatedCount target={value} />
        </p>
        <p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Animated integer counter — tweens from 0 → target on mount.
 * Subtle, premium touch you see in Vercel / Linear marketing.
 */
function AnimatedCount({ target }: { target: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const duration = 700;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return <>{n}</>;
}

// ---------------------------------------------------------------------------
// Agent detail panel
// ---------------------------------------------------------------------------

function AgentDetailPanel({ agent }: { agent: PublicAgentConfig }) {
  const marketing = MARKETING[agent.slug] ?? FALLBACK_MARKETING;
  const capabilities = deriveCapabilities(agent);

  return (
    <article className="mx-auto max-w-3xl">
      <Card className="overflow-hidden">
        {/* Top accent strip — category-colored gradient */}
        <div className={cn('h-1.5 bg-gradient-to-r', CATEGORY_STRIP[agent.category])} />

        <CardContent className="p-8 sm:p-10">
          {/* Header row */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-baseline gap-4">
              <span className="text-4xl leading-none">{agent.icon}</span>
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn('h-1.5 w-1.5 rounded-full', CATEGORY_DOT[agent.category])}
                  />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {CATEGORY_LABEL[agent.category]}
                  </span>
                </div>
                <h1 className="mt-1 font-serif text-3xl font-bold leading-tight text-foreground sm:text-4xl">
                  {agent.name}
                </h1>
              </div>
            </div>
          </div>

          <p className="mt-6 text-base leading-relaxed text-muted-foreground sm:text-lg">
            {agent.description}
          </p>

          {/* Capability chips */}
          {capabilities.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-1.5">
              {capabilities.map((c) => (
                <Tooltip key={c.label}>
                  <TooltipTrigger asChild>
                    <Badge variant="secondary" className="gap-1.5 font-medium cursor-default">
                      <c.Icon className="h-3 w-3" />
                      <span>{c.label}</span>
                    </Badge>
                  </TooltipTrigger>
                  {c.tooltip && <TooltipContent>{c.tooltip}</TooltipContent>}
                </Tooltip>
              ))}
            </div>
          )}

          {/* Two-col: What it does + What you bring */}
          <div className="mt-8 grid grid-cols-1 gap-8 sm:grid-cols-2">
            {marketing.highlights.length > 0 && (
              <DetailSection title="What it does">
                <ul className="space-y-2">
                  {marketing.highlights.map((h, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2.5 text-sm leading-relaxed text-foreground/85"
                    >
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </DetailSection>
            )}

            <DetailSection title="What you bring">
              {agent.fileSlots.length > 0 ? (
                <ul className="space-y-2.5">
                  {agent.fileSlots.map((slot) => (
                    <li key={slot.key} className="text-sm leading-relaxed">
                      <div className="flex items-baseline gap-2">
                        <FileText className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <span className="font-medium text-foreground">{slot.label}</span>
                          {!slot.required && (
                            <Badge
                              variant="muted"
                              size="sm"
                              className="ml-1.5 font-normal"
                            >
                              optional
                            </Badge>
                          )}
                          <div className="text-xs text-muted-foreground">
                            {slot.extensions.join(', ')}
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm leading-relaxed text-muted-foreground">
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
                  <Badge key={i} variant="accent" className="gap-1 font-medium">
                    <ArrowRight className="h-3 w-3" />
                    {o}
                  </Badge>
                ))}
              </div>
            </DetailSection>
          )}

          {/* CTA */}
          <Separator className="my-8" />
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <p className="text-xs text-muted-foreground">
              No signup · runs in under a minute · 3-row preview free
            </p>
            <Button asChild size="lg" className="group">
              <Link href={`/agents/${agent.slug}`}>
                Try this agent
                <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
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
      <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Capability derivation
// ---------------------------------------------------------------------------

function deriveCapabilities(agent: PublicAgentConfig): Array<{
  Icon: typeof Sparkles;
  label: string;
  tooltip?: string;
}> {
  const caps: Array<{ Icon: typeof Sparkles; label: string; tooltip?: string }> = [];

  if (agent.dynamicWizard) {
    caps.push({
      Icon: Sparkles,
      label: 'Dynamic wizard',
      tooltip: 'Questions are built from your uploaded file',
    });
  } else if (AGENTS_WITH_PRESET_WIZARD.has(agent.slug)) {
    caps.push({
      Icon: ListChecks,
      label: 'Guided setup',
      tooltip: 'A short MCQ wizard anchors the agent to your context',
    });
  }

  if (AGENTS_USING_WEB_TOOLS.has(agent.slug)) {
    caps.push({
      Icon: Globe,
      label: 'Live web tools',
      tooltip: 'Calls real web search + page fetches when needed',
    });
  }
  if (LEVEL_4_AGENTS.has(agent.slug)) {
    caps.push({
      Icon: Bot,
      label: 'Level 4 autonomous',
      tooltip:
        'Plans, self-monitors, drafts the action, and self-reviews before submitting',
    });
  }

  return caps;
}

function uniqueCount<T>(items: T[]): number {
  return new Set(items).size;
}

const AGENTS_WITH_PRESET_WIZARD = new Set([
  'lead-qualifier',
  'gcc-prospector',
  'vendor-evaluator',
  'churn-risk',
  'sales-proposal',
  'ar-collections',
]);
const AGENTS_USING_WEB_TOOLS = new Set([
  'lead-qualifier',
  'invoice-auditor',
  'gcc-prospector',
  'vendor-evaluator',
  'resume-screener',
  'churn-risk',
  'sales-proposal',
  'ar-collections',
]);
const LEVEL_4_AGENTS = new Set([
  'invoice-auditor',
  'gcc-prospector',
  'churn-risk',
  'sales-proposal',
  'ar-collections',
]);
