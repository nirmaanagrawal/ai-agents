'use client';

/**
 * Shared per-agent result + trace renderers.
 *
 * The `AgentChat` interface pulls from this file. Adding a new agent?
 * Add a `case` in `ResultsBody` plus a small view component below.
 */
import { useMemo, useState } from 'react';
import type {
  AgentTurnRecord,
  PublicAgentConfig,
  ToolCallRecord,
} from '@/lib/agents/types';

// ---------------------------------------------------------------------------
// Top-level dispatch
// ---------------------------------------------------------------------------

export function ResultsBody({
  slug,
  result,
}: {
  slug: string;
  result: Record<string, unknown>;
}) {
  switch (slug) {
    case 'lead-qualifier':
      return <LeadsView result={result} />;
    case 'invoice-auditor':
      return <InvoicesView result={result} />;
    case 'gcc-prospector':
      return <ProspectsView result={result} />;
    case 'vendor-evaluator':
      return <VendorsView result={result} />;
    case 'resume-screener':
      return <CandidatesView result={result} />;
    case 'churn-risk':
      return <AccountsView result={result} />;
    case 'sales-proposal':
      return <ProposalView result={result} />;
    default:
      return <GenericJsonView result={result} />;
  }
}

// ---------------------------------------------------------------------------
// Agent turn timeline (one entry per assistant turn the SDK ran)
// ---------------------------------------------------------------------------

/**
 * Vertical timeline showing each turn the agent took.
 *
 * With the Agent SDK we no longer declare named steps — the SDK runs
 * the loop autonomously. We capture each assistant turn as it happens
 * (with its narration and tool calls) and render that as the trace.
 * It's a cleaner mental model: visitors see the agent's thinking turn
 * by turn rather than a pre-baked workflow.
 */
export function AgentTurnTraceView({ trace }: { trace: AgentTurnRecord[] }) {
  const [expandedTurn, setExpandedTurn] = useState<number | null>(null);

  const completed = trace.filter((t) => t.status === 'completed').length;
  const totalMs = trace.reduce((n, t) => n + t.durationMs, 0);
  const totalToolCalls = trace.reduce((n, t) => n + (t.toolCalls?.length ?? 0), 0);

  return (
    <div className="rounded-lg border border-cream-200 bg-cream-50 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm">
        <span className="text-brand-500">⚙️</span>
        <span className="font-medium text-ink-900">
          Agent ran {completed} turn{completed === 1 ? '' : 's'}
          {totalToolCalls > 0 && (
            <span className="text-brand-500"> · {totalToolCalls} tool call{totalToolCalls === 1 ? '' : 's'}</span>
          )}
        </span>
        {totalMs > 0 && (
          <span className="text-xs text-brand-400">· {(totalMs / 1000).toFixed(1)}s</span>
        )}
      </div>

      <ol className="space-y-1.5">
        {trace.map((turn) => {
          const isExpanded = expandedTurn === turn.turn;
          const hasToolCalls = (turn.toolCalls?.length ?? 0) > 0;
          const isClickable = hasToolCalls || Boolean(turn.narration);
          return (
            <li key={turn.turn}>
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => setExpandedTurn(isExpanded ? null : turn.turn)}
                className={`group flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
                  isClickable ? 'hover:bg-cream-200/50' : ''
                }`}
              >
                <TurnIcon status={turn.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink-900">Turn {turn.turn}</span>
                    <span className="flex items-center gap-2 text-xs text-ink-500">
                      {hasToolCalls && (
                        <span className="rounded bg-brand-100 px-1.5 text-brand-600">
                          🔧 {turn.toolCalls!.length}
                        </span>
                      )}
                      {turn.modelTokens !== undefined && turn.modelTokens > 0 && (
                        <span>{turn.modelTokens.toLocaleString()} tok</span>
                      )}
                      {turn.durationMs > 0 && (
                        <span>{(turn.durationMs / 1000).toFixed(1)}s</span>
                      )}
                    </span>
                  </div>
                  {turn.narration && (
                    <p
                      className={`mt-0.5 line-clamp-2 text-xs ${
                        turn.status === 'failed' ? 'text-red-700' : 'text-ink-700'
                      }`}
                    >
                      {turn.narration}
                    </p>
                  )}
                </div>
              </button>

              {isExpanded && (
                <div className="ml-8 mt-1 space-y-1 border-l-2 border-cream-300 pl-3">
                  {turn.narration && (
                    <p className="whitespace-pre-wrap text-xs text-ink-700">
                      {turn.narration}
                    </p>
                  )}
                  {turn.toolCalls?.map((t, j) => (
                    <ToolCallRow key={j} call={t} />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function TurnIcon({ status }: { status: AgentTurnRecord['status'] }) {
  const map: Record<
    AgentTurnRecord['status'],
    { char: string; classes: string; label: string }
  > = {
    completed: { char: '✓', classes: 'bg-green-100 text-green-700', label: 'Completed' },
    failed: { char: '✕', classes: 'bg-red-100 text-red-700', label: 'Failed' },
  };
  const { char, classes, label } = map[status];
  return (
    <span
      title={label}
      className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${classes}`}
    >
      {char}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Flat tool-call trace (Level-2 agents only — L3 folds these into the workflow)
// ---------------------------------------------------------------------------

export function ToolTraceView({ trace }: { trace: ToolCallRecord[] }) {
  const [expanded, setExpanded] = useState(false);
  const counts = useMemo(() => {
    const m = new Map<string, { ok: number; failed: number }>();
    for (const t of trace) {
      const e = m.get(t.tool) ?? { ok: 0, failed: 0 };
      if (t.failed) e.failed += 1;
      else e.ok += 1;
      m.set(t.tool, e);
    }
    return Array.from(m.entries());
  }, [trace]);
  const totalMs = trace.reduce((n, t) => n + (t.durationMs || 0), 0);

  return (
    <div className="rounded-lg border border-brand-100 bg-brand-50/50 p-3">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-2 text-sm">
          <span className="text-brand-500">🔧</span>
          <span className="font-medium text-brand-700">
            Agent made {trace.length} tool call{trace.length === 1 ? '' : 's'}
          </span>
          <span className="text-xs text-brand-600">
            {counts
              .map(([t, { ok, failed }]) =>
                failed > 0 ? `${t} (${ok}✓ ${failed}✗)` : `${t} (${ok})`,
              )
              .join(' · ')}
          </span>
          {totalMs > 0 && (
            <span className="text-xs text-brand-500">· {(totalMs / 1000).toFixed(1)}s</span>
          )}
        </div>
        <span className="text-xs text-brand-500">{expanded ? 'Hide' : 'Show'}</span>
      </button>
      {expanded && (
        <ol className="mt-3 space-y-2">
          {trace.map((t, i) => (
            <li key={i}>
              <ToolCallRow call={t} idx={i + 1} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ToolCallRow({ call: t, idx }: { call: ToolCallRecord; idx?: number }) {
  return (
    <div
      className={`rounded border px-2 py-1.5 text-xs ${
        t.failed
          ? 'border-red-200 bg-red-50 text-red-800'
          : 'border-brand-100 bg-white text-ink-700'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono font-medium">
          {idx != null ? `${idx}. ` : ''}
          {t.tool}
        </span>
        {t.durationMs > 0 && <span className="text-ink-300">{t.durationMs}ms</span>}
      </div>
      <div className="mt-0.5 truncate font-mono text-ink-500">{JSON.stringify(t.args)}</div>
      <div className={`mt-0.5 ${t.failed ? 'text-red-700' : 'text-brand-600'}`}>
        → {t.summary}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-agent result views
// ---------------------------------------------------------------------------

function LeadsView({ result }: { result: Record<string, unknown> }) {
  const leadsRaw = result.leads;
  const leads: Array<Record<string, unknown>> = Array.isArray(leadsRaw)
    ? (leadsRaw as Array<Record<string, unknown>>)
    : [];
  const hot = numberOrUndef(result.hotCount);
  const warm = numberOrUndef(result.warmCount);
  const total = numberOrUndef(result.totalLeads) ?? leads.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-lg font-semibold text-ink-900">
          Scored {total} lead{total === 1 ? '' : 's'}
        </h3>
        <div className="flex gap-2 text-xs font-medium">
          {hot !== undefined && (
            <span className="rounded bg-red-100 px-2 py-1 text-red-700">{hot} HOT</span>
          )}
          {warm !== undefined && (
            <span className="rounded bg-yellow-100 px-2 py-1 text-yellow-700">
              {warm} WARM
            </span>
          )}
        </div>
      </div>
      <div className="space-y-2">
        {leads.map((lead, i) => (
          <LeadRow key={i} lead={lead} />
        ))}
      </div>
    </div>
  );
}

function LeadRow({ lead }: { lead: Record<string, unknown> }) {
  const name = stringOr(lead.name, '—');
  const email = stringOr(lead.email, '');
  const score = numberOrUndef(lead.score) ?? 0;
  const grade = stringOr(lead.grade, 'COLD');
  const reasoning = stringOr(lead.reasoning, '');
  const outreach = stringOr(lead.suggestedOutreach, '');

  const gradeClasses =
    grade === 'HOT'
      ? 'bg-red-100 text-red-700'
      : grade === 'WARM'
        ? 'bg-yellow-100 text-yellow-700'
        : 'bg-cream-200 text-ink-700';

  return (
    <div className="rounded-lg border bg-white p-3 transition-shadow hover:shadow-sm">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{name}</p>
          {email && <p className="truncate text-sm text-ink-500">{email}</p>}
        </div>
        <div className={`rounded-full px-3 py-1 text-xs font-bold ${gradeClasses}`}>
          {grade} · {score}/100
        </div>
      </div>
      {reasoning && <p className="mt-2 text-sm text-ink-700">{reasoning}</p>}
      {outreach && <p className="mt-1 text-xs text-brand-500">💬 {outreach}</p>}
    </div>
  );
}

function InvoicesView({ result }: { result: Record<string, unknown> }) {
  const invoicesRaw = result.invoices;
  const invoices: Array<Record<string, unknown>> = Array.isArray(invoicesRaw)
    ? (invoicesRaw as Array<Record<string, unknown>>)
    : [];

  const total = numberOrUndef(result.totalInvoices) ?? invoices.length;
  const autoApprove = numberOrUndef(result.autoApproveCount);
  const needsReview = numberOrUndef(result.needsReviewCount);
  const rejected = numberOrUndef(result.rejectedCount);
  const lowConfidence = numberOrUndef(result.lowConfidenceCount);
  const savings = numberOrUndef(result.potentialSavingsUSD);
  const totalValue = numberOrUndef(result.totalValueUSD);

  const agentPlan = stringOr(result.agentPlan, '');
  const selfReview = stringOr(result.selfReviewNotes, '');

  const vendorPatterns = Array.isArray(result.vendorPatterns)
    ? (result.vendorPatterns as Array<Record<string, unknown>>)
    : [];
  const policyRecs = Array.isArray(result.policyRecommendations)
    ? (result.policyRecommendations as unknown[]).filter(
        (s): s is string => typeof s === 'string',
      )
    : [];
  const escalations = Array.isArray(result.escalations)
    ? (result.escalations as Array<Record<string, unknown>>)
    : [];

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-serif text-lg font-semibold text-ink-900">
          Audited {total} invoice{total === 1 ? '' : 's'}
          {totalValue !== undefined && (
            <span className="ml-2 text-sm font-normal text-ink-500">
              · {formatUSD(totalValue)} total
            </span>
          )}
        </h3>
      </div>

      {/* Agent plan — surfaced to the user as the "what I'm about
          to do" statement, the autonomous-agent giveaway. */}
      {agentPlan && (
        <div className="rounded-lg border border-brand-100 bg-brand-gradient-soft p-3 text-sm text-ink-900">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-brand-700">
            🤖 Agent plan
          </p>
          <p className="leading-relaxed">{agentPlan}</p>
        </div>
      )}

      <div className="grid grid-cols-4 gap-2 text-xs font-medium">
        {autoApprove !== undefined && (
          <div className="rounded bg-emerald-50 px-3 py-2 text-emerald-700">
            <div className="text-lg font-bold">{autoApprove}</div>
            <div>Auto-approve</div>
          </div>
        )}
        {needsReview !== undefined && (
          <div className="rounded bg-amber-50 px-3 py-2 text-amber-800">
            <div className="text-lg font-bold">{needsReview}</div>
            <div>Needs review</div>
          </div>
        )}
        {rejected !== undefined && (
          <div className="rounded bg-red-50 px-3 py-2 text-red-700">
            <div className="text-lg font-bold">{rejected}</div>
            <div>Rejected</div>
          </div>
        )}
        {lowConfidence !== undefined && (
          <div className="rounded bg-cream-200 px-3 py-2 text-ink-700">
            <div className="text-lg font-bold">{lowConfidence}</div>
            <div>Low confidence</div>
          </div>
        )}
      </div>

      {savings !== undefined && savings > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <span className="font-semibold">Potential savings identified:</span>{' '}
          {formatUSD(savings)}
        </div>
      )}

      <div className="space-y-2">
        {invoices.map((inv, i) => (
          <InvoiceRow key={i} invoice={inv} />
        ))}
      </div>

      {/* Batch-level analysis sections — what makes this Level 4 */}
      {vendorPatterns.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-sm font-semibold text-amber-900">
            🔁 Vendor patterns across this batch
          </p>
          <ul className="space-y-1.5 text-sm text-ink-900">
            {vendorPatterns.map((p, i) => (
              <li key={i}>
                <span className="font-medium">{stringOr(p.vendor, '—')}</span>
                <span className="text-ink-700"> — {stringOr(p.pattern, '')}</span>
                {numberOrUndef(p.affectedInvoices) !== undefined && (
                  <span className="text-ink-500"> ({stringOr(p.affectedInvoices, '')} invoices)</span>
                )}
                <p className="ml-3 text-xs text-brand-700">
                  → {stringOr(p.recommendedAction, '')}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {escalations.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="mb-2 text-sm font-semibold text-red-900">
            🚩 Escalations (beyond standard routing)
          </p>
          <ul className="space-y-1.5 text-sm text-ink-900">
            {escalations.map((e, i) => (
              <li key={i}>
                <span className="font-medium">{stringOr(e.invoiceNumber, '—')}</span>
                <span className="text-ink-700"> · {stringOr(e.vendor, '—')}</span>
                <span className="ml-2 text-xs text-red-700">
                  → escalate to {stringOr(e.escalateTo, '')}
                </span>
                <p className="text-xs text-ink-700">{stringOr(e.reason, '')}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {policyRecs.length > 0 && (
        <div className="rounded-lg border border-cream-200 bg-cream-50 p-3">
          <p className="mb-2 text-sm font-semibold text-ink-900">
            💡 Policy recommendations
          </p>
          <ul className="space-y-1 text-sm text-ink-700">
            {policyRecs.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
        </div>
      )}

      {selfReview && (
        <div className="rounded-lg border border-cream-200 bg-white p-3">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-500">
            🪞 Agent self-review
          </p>
          <p className="text-sm italic text-ink-700">{selfReview}</p>
        </div>
      )}
    </div>
  );
}

function InvoiceRow({ invoice }: { invoice: Record<string, unknown> }) {
  const invoiceNumber = stringOr(invoice.invoiceNumber, '—');
  const vendor = stringOr(invoice.vendor, '—');
  const amount = numberOrUndef(invoice.amount);
  const currency = stringOr(invoice.currency, 'USD');
  const poNumber = stringOr(invoice.poNumber, '');
  const matchStatus = stringOr(invoice.matchStatus, 'NO_PO');
  const decision = stringOr(invoice.decision, 'ROUTE_TO_MANAGER');
  const confidence = numberOrUndef(invoice.confidence);
  const reasoning = stringOr(invoice.reasoning, '');
  const suggestedAction = stringOr(invoice.suggestedAction, '');
  const approvalDraft = stringOr(invoice.approvalDraft, '');
  const vendorOutreach = stringOr(invoice.vendorOutreachDraft, '');
  const discrepancies = Array.isArray(invoice.discrepancies)
    ? (invoice.discrepancies as unknown[]).filter((d): d is string => typeof d === 'string')
    : [];

  const decisionClasses =
    decision === 'AUTO_APPROVE'
      ? 'bg-emerald-100 text-emerald-700'
      : decision === 'REJECT'
        ? 'bg-red-100 text-red-700'
        : decision === 'ROUTE_TO_CFO'
          ? 'bg-brand-100 text-brand-700'
          : 'bg-amber-100 text-amber-800';
  const matchClasses =
    matchStatus === 'EXACT'
      ? 'text-emerald-600'
      : matchStatus === 'WITHIN_TOLERANCE'
        ? 'text-emerald-700'
        : matchStatus === 'VARIANCE' || matchStatus === 'DUPLICATE'
          ? 'text-red-600'
          : 'text-ink-500';
  // Confidence colors: ≥85 emerald, 70-84 amber-ish, <70 red-tinted.
  const confidenceClasses =
    confidence === undefined
      ? 'text-ink-500'
      : confidence >= 85
        ? 'text-emerald-700'
        : confidence >= 70
          ? 'text-amber-700'
          : 'text-red-700';

  return (
    <div className="rounded-lg border bg-white p-3 transition-shadow hover:shadow-brand-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink-900">
            {invoiceNumber}
            <span className="ml-2 text-sm font-normal text-ink-500">{vendor}</span>
          </p>
          <p className="mt-0.5 text-sm text-ink-700">
            {amount !== undefined && (
              <span className="font-medium">
                {currency === 'USD'
                  ? formatUSD(amount)
                  : `${currency} ${amount.toFixed(2)}`}
              </span>
            )}
            {poNumber && (
              <>
                <span className="mx-2 text-ink-300">·</span>
                <span>PO {poNumber}</span>
              </>
            )}
            <span className="mx-2 text-ink-300">·</span>
            <span className={matchClasses}>{formatEnum(matchStatus)}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div
            className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${decisionClasses}`}
          >
            {formatEnum(decision)}
          </div>
          {confidence !== undefined && (
            <div
              className={`text-[11px] font-medium ${confidenceClasses}`}
              title="Agent's confidence in this decision (0-100). <70 deserves a human sanity check."
            >
              {confidence}% confidence
            </div>
          )}
        </div>
      </div>
      {discrepancies.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-red-700">
          {discrepancies.map((d, i) => (
            <li key={i}>⚠ {d}</li>
          ))}
        </ul>
      )}
      {reasoning && <p className="mt-2 text-sm text-ink-700">{reasoning}</p>}
      {suggestedAction && (
        <p className="mt-1 text-xs text-brand-500">→ {suggestedAction}</p>
      )}

      {/* Paste-ready drafts — collapsed by default since most users
          just want the decision; opening these reveals what the
          agent autonomously wrote for action-taking. */}
      {(approvalDraft || vendorOutreach) && (
        <div className="mt-2 space-y-1.5">
          {approvalDraft && (
            <details className="rounded border border-cream-200 bg-cream-50 px-2 py-1.5 text-xs">
              <summary className="cursor-pointer font-medium text-ink-900">
                📨 Approval / internal email — paste into your tool
              </summary>
              <pre className="mt-1.5 whitespace-pre-wrap font-sans text-xs text-ink-700">
                {approvalDraft}
              </pre>
            </details>
          )}
          {vendorOutreach && (
            <details className="rounded border border-brand-100 bg-brand-50 px-2 py-1.5 text-xs">
              <summary className="cursor-pointer font-medium text-brand-700">
                ✉ Vendor outreach draft — paste verbatim
              </summary>
              <pre className="mt-1.5 whitespace-pre-wrap font-sans text-xs text-ink-700">
                {vendorOutreach}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GCC Prospector results
// ---------------------------------------------------------------------------

/**
 * Card-based prospect list. Each card surfaces the most decision-
 * useful info on the surface (HQ, India city, role count, fit grade)
 * and tucks the longer reasoning + outreach below.
 */
function ProspectsView({ result }: { result: Record<string, unknown> }) {
  const raw = result.prospects;
  const prospects: Array<Record<string, unknown>> = Array.isArray(raw)
    ? (raw as Array<Record<string, unknown>>)
    : [];
  const total = numberOrUndef(result.totalProspects) ?? prospects.length;
  const hot = numberOrUndef(result.hotCount);
  const warm = numberOrUndef(result.warmCount);
  const cold = numberOrUndef(result.coldCount);
  const lowConf = numberOrUndef(result.lowConfidenceCount);
  const summary = stringOr(result.searchSummary, '');
  const agentPlan = stringOr(result.agentPlan, '');
  const selfReview = stringOr(result.selfReviewNotes, '');
  const insights = Array.isArray(result.crossBatchInsights)
    ? (result.crossBatchInsights as unknown[]).filter(
        (s): s is string => typeof s === 'string',
      )
    : [];

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-serif text-lg font-semibold text-ink-900">
          Found {total} prospect{total === 1 ? '' : 's'}
        </h3>
        {summary && <p className="mt-1 text-sm text-ink-700">{summary}</p>}
      </div>

      {/* Agent plan — Level-4 hallmark; surface up-front like a
          status note from the sales agent to the AE. */}
      {agentPlan && (
        <div className="rounded-lg border border-brand-100 bg-brand-gradient-soft p-3 text-sm text-ink-900">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-brand-700">
            🤖 Agent plan
          </p>
          <p className="leading-relaxed">{agentPlan}</p>
        </div>
      )}

      <div className="grid grid-cols-4 gap-2 text-xs font-medium">
        {hot !== undefined && (
          <div className="rounded bg-brand-500 px-3 py-2 text-white">
            <div className="text-lg font-bold">{hot}</div>
            <div>HOT</div>
          </div>
        )}
        {warm !== undefined && (
          <div className="rounded bg-amber-50 px-3 py-2 text-amber-700">
            <div className="text-lg font-bold">{warm}</div>
            <div>WARM</div>
          </div>
        )}
        {cold !== undefined && (
          <div className="rounded bg-cream-200 px-3 py-2 text-ink-700">
            <div className="text-lg font-bold">{cold}</div>
            <div>COLD</div>
          </div>
        )}
        {lowConf !== undefined && (
          <div className="rounded bg-red-50 px-3 py-2 text-red-700">
            <div className="text-lg font-bold">{lowConf}</div>
            <div>Low confidence</div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {prospects.map((p, i) => (
          <ProspectRow key={i} prospect={p} />
        ))}
      </div>

      {insights.length > 0 && (
        <div className="rounded-lg border border-brand-100 bg-brand-50 p-3">
          <p className="mb-2 text-sm font-semibold text-brand-700">
            🔭 Cross-batch insights
          </p>
          <ul className="space-y-1 text-sm text-ink-900">
            {insights.map((s, i) => (
              <li key={i}>• {s}</li>
            ))}
          </ul>
        </div>
      )}

      {selfReview && (
        <div className="rounded-lg border border-cream-200 bg-white p-3">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-500">
            🪞 Agent self-review
          </p>
          <p className="text-sm italic text-ink-700">{selfReview}</p>
        </div>
      )}
    </div>
  );
}

function ProspectRow({ prospect }: { prospect: Record<string, unknown> }) {
  const name = stringOr(prospect.companyName, '—');
  const hqCountry = stringOr(prospect.hqCountry, '');
  const hqCity = stringOr(prospect.hqCity, '');
  const industry = stringOr(prospect.industry, '');
  const fundingStage = stringOr(prospect.fundingStage, '');
  const parentWebsite = stringOr(prospect.parentWebsite, '');
  const grade = stringOr(prospect.fitGrade, 'COLD');
  const score = numberOrUndef(prospect.fitScore) ?? 0;
  const confidence = numberOrUndef(prospect.confidence);
  const reasoning = stringOr(prospect.reasoning, '');
  // The new outreachDraft is the Level-4 field; fall back to the
  // legacy suggestedOutreach if a cached result happens to still
  // have it.
  const outreach =
    stringOr(prospect.outreachDraft, '') ||
    stringOr(prospect.suggestedOutreach, '');
  const underTheRadar = Boolean(prospect.underTheRadar);
  const careersUrl = stringOr(prospect.careersUrl, '');
  const signals = Array.isArray(prospect.signals)
    ? (prospect.signals as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  const followUps = Array.isArray(prospect.followUpResearch)
    ? (prospect.followUpResearch as unknown[]).filter(
        (s): s is string => typeof s === 'string',
      )
    : [];

  const confidenceClasses =
    confidence === undefined
      ? 'text-ink-500'
      : confidence >= 85
        ? 'text-emerald-700'
        : confidence >= 70
          ? 'text-amber-700'
          : 'text-red-700';

  const presence = prospect.indiaPresence as Record<string, unknown> | undefined;
  const cities = Array.isArray(presence?.cities)
    ? (presence!.cities as unknown[]).filter((c): c is string => typeof c === 'string')
    : [];
  const indiaTeamSize = stringOr(presence?.estimatedTeamSize, '');
  const openRoles = numberOrUndef(presence?.openEngineeringRoles);
  const sampleRoles = Array.isArray(presence?.sampleRolesPosted)
    ? (presence!.sampleRolesPosted as unknown[]).filter((r): r is string => typeof r === 'string')
    : [];

  const gradeClasses =
    grade === 'HOT'
      ? 'bg-brand-500 text-white'
      : grade === 'WARM'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-cream-200 text-ink-700';

  return (
    <div className="rounded-lg border bg-white p-4 transition-shadow hover:shadow-brand-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-medium text-ink-900">
            <span className="truncate">{name}</span>
            {underTheRadar && (
              <span
                className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700"
                title="Not covered in mainstream GCC press"
              >
                under-the-radar
              </span>
            )}
          </p>
          <p className="mt-0.5 text-sm text-ink-700">
            {[hqCity && `${hqCity}, ${hqCountry}`.replace(/^, /, ''), hqCountry && !hqCity ? hqCountry : '', industry, fundingStage]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {parentWebsite && (
            <a
              href={parentWebsite.startsWith('http') ? parentWebsite : `https://${parentWebsite}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 inline-block text-xs text-brand-600 hover:underline"
            >
              {parentWebsite.replace(/^https?:\/\//, '')}
            </a>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div
            className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold ${gradeClasses}`}
          >
            {grade} · {score}/100
          </div>
          {confidence !== undefined && (
            <div
              className={`text-[11px] font-medium ${confidenceClasses}`}
              title="How thoroughly the agent verified this prospect. <70 = the AE should double-check before sending."
            >
              {confidence}% confidence
            </div>
          )}
        </div>
      </div>

      {/* India presence block — the actual GCC verification */}
      <div className="mt-3 rounded-lg bg-cream-50 p-2.5 text-xs text-ink-700">
        <div className="flex items-center gap-2 font-medium text-ink-900">
          <span>🌏</span>
          <span>India presence</span>
        </div>
        <div className="mt-1 space-y-0.5">
          {cities.length > 0 && (
            <div>
              <span className="text-ink-500">Cities:</span>{' '}
              <span className="font-medium">{cities.join(', ')}</span>
            </div>
          )}
          {indiaTeamSize && (
            <div>
              <span className="text-ink-500">Team size:</span>{' '}
              <span className="font-medium">{indiaTeamSize}</span>
            </div>
          )}
          {openRoles !== undefined && (
            <div>
              <span className="text-ink-500">Open eng roles:</span>{' '}
              <span className="font-medium">{openRoles}</span>
              {sampleRoles.length > 0 && (
                <span className="text-ink-500"> — {sampleRoles.slice(0, 3).join(', ')}</span>
              )}
            </div>
          )}
          {careersUrl && (
            <a
              href={careersUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-600 hover:underline"
            >
              Careers page →
            </a>
          )}
        </div>
      </div>

      {signals.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-ink-700">
          {signals.map((s, i) => (
            <li key={i}>• {s}</li>
          ))}
        </ul>
      )}
      {reasoning && <p className="mt-2 text-sm text-ink-700">{reasoning}</p>}

      {/* Paste-ready outreach + follow-up research — the Level-4
          additions. Outreach is collapsed by default; the AE opens
          it when they're ready to send. */}
      {outreach && (
        <details className="mt-2 rounded border border-brand-100 bg-brand-50 px-2 py-1.5 text-xs">
          <summary className="cursor-pointer font-medium text-brand-700">
            ✉ First-touch outreach — paste-ready
          </summary>
          <pre className="mt-1.5 whitespace-pre-wrap font-sans text-xs text-ink-700">
            {outreach}
          </pre>
        </details>
      )}

      {followUps.length > 0 && (
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs">
          <p className="font-medium text-amber-800">🔍 Verify before sending</p>
          <ul className="mt-0.5 space-y-0.5 text-ink-700">
            {followUps.map((f, i) => (
              <li key={i}>· {f}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vendor Evaluator results
// ---------------------------------------------------------------------------

/**
 * Vendor scorecard view. Header carries the portfolio-level numbers
 * (executive summary, headline counts, health score, concentration
 * warning); each row below is one vendor with KPI metrics + grade +
 * recommended action.
 */
function VendorsView({ result }: { result: Record<string, unknown> }) {
  const raw = result.vendors;
  const vendors: Array<Record<string, unknown>> = Array.isArray(raw)
    ? (raw as Array<Record<string, unknown>>)
    : [];
  const total = numberOrUndef(result.totalVendors) ?? vendors.length;
  const top = numberOrUndef(result.topPerformerCount);
  const review = numberOrUndef(result.needsReviewCount);
  const chronic = numberOrUndef(result.chronicUnderperformerCount);
  const newCount = numberOrUndef(result.newVendorCount);
  const health = numberOrUndef(result.portfolioHealthScore);
  const totalSpend = numberOrUndef(result.totalSpendReviewed);
  const period = stringOr(result.reviewPeriod, '');
  const summary = stringOr(result.executiveSummary, '');
  const concentration = stringOr(result.spendConcentrationWarning, '');

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-serif text-lg font-semibold text-ink-900">
          Reviewed {total} vendor{total === 1 ? '' : 's'}
          {period && (
            <span className="ml-2 text-sm font-normal text-ink-500">· {period}</span>
          )}
          {totalSpend !== undefined && (
            <span className="ml-2 text-sm font-normal text-ink-500">
              · {formatNumberCompact(totalSpend)} total spend
            </span>
          )}
        </h3>
        {summary && <p className="mt-1 text-sm text-ink-700">{summary}</p>}
      </div>

      <div className="grid grid-cols-4 gap-2 text-xs font-medium">
        {health !== undefined && (
          <div className="rounded bg-brand-gradient px-3 py-2 text-white">
            <div className="text-lg font-bold">{health}</div>
            <div>Health score</div>
          </div>
        )}
        {top !== undefined && (
          <div className="rounded bg-emerald-50 px-3 py-2 text-emerald-700">
            <div className="text-lg font-bold">{top}</div>
            <div>Top performers</div>
          </div>
        )}
        {review !== undefined && (
          <div className="rounded bg-amber-50 px-3 py-2 text-amber-700">
            <div className="text-lg font-bold">{review}</div>
            <div>Needs review</div>
          </div>
        )}
        {chronic !== undefined && (
          <div className="rounded bg-red-50 px-3 py-2 text-red-700">
            <div className="text-lg font-bold">{chronic}</div>
            <div>Chronic</div>
          </div>
        )}
      </div>

      {newCount !== undefined && newCount > 0 && (
        <div className="rounded-lg border border-cream-200 bg-cream-50 px-3 py-2 text-xs text-ink-700">
          ✨ {newCount} new vendor{newCount === 1 ? '' : 's'} in this period —
          tracked on probation until a full quarter of data lands.
        </div>
      )}

      {concentration && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          ⚠ <span className="font-medium">Spend concentration:</span> {concentration}
        </div>
      )}

      <div className="space-y-2">
        {vendors.map((v, i) => (
          <VendorRow key={i} vendor={v} />
        ))}
      </div>
    </div>
  );
}

function VendorRow({ vendor }: { vendor: Record<string, unknown> }) {
  const name = stringOr(vendor.vendorName, '—');
  const vendorId = stringOr(vendor.vendorId, '');
  const category = stringOr(vendor.category, '');
  const spend = numberOrUndef(vendor.spendInPeriod);
  const currency = stringOr(vendor.currency, '');
  const txCount = numberOrUndef(vendor.transactionCount);
  const grade = stringOr(vendor.grade, 'NEEDS_REVIEW');
  const score = numberOrUndef(vendor.compositeScore) ?? 0;
  const trend = stringOr(vendor.trend, 'INSUFFICIENT_DATA');
  const isStrategic = Boolean(vendor.isStrategic);
  const isChronic = Boolean(vendor.isChronic);
  const reasoning = stringOr(vendor.reasoning, '');
  const action = stringOr(vendor.recommendedAction, '');
  const reviewNotes = stringOr(vendor.reviewNotes, '');

  const metrics = vendor.metrics as Record<string, unknown> | undefined;
  const otd = numberOrUndef(metrics?.onTimeDeliveryRate);
  const defect = numberOrUndef(metrics?.defectRate);
  const invAcc = numberOrUndef(metrics?.invoiceAccuracyRate);
  const leadTime = numberOrUndef(metrics?.avgLeadTimeDays);
  const fill = numberOrUndef(metrics?.fillRate);

  const issues = Array.isArray(vendor.keyIssues)
    ? (vendor.keyIssues as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  const positives = Array.isArray(vendor.positives)
    ? (vendor.positives as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];

  const gradeClasses =
    grade === 'EXCELLENT'
      ? 'bg-emerald-100 text-emerald-700'
      : grade === 'GOOD'
        ? 'bg-emerald-50 text-emerald-700'
        : grade === 'NEEDS_REVIEW'
          ? 'bg-amber-100 text-amber-800'
          : 'bg-red-100 text-red-700';

  const trendIcon =
    trend === 'IMPROVING' ? '↗' : trend === 'DECLINING' ? '↘' : trend === 'STABLE' ? '→' : '?';
  const trendClasses =
    trend === 'IMPROVING'
      ? 'text-emerald-600'
      : trend === 'DECLINING'
        ? 'text-red-600'
        : 'text-ink-500';

  return (
    <div className="rounded-lg border bg-white p-3 transition-shadow hover:shadow-brand-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium text-ink-900">
            <span className="truncate">{name}</span>
            {vendorId && (
              <span className="text-xs font-normal text-ink-500">#{vendorId}</span>
            )}
            {isStrategic && (
              <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">
                strategic
              </span>
            )}
            {isChronic && (
              <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                chronic
              </span>
            )}
          </p>
          <p className="mt-0.5 text-sm text-ink-700">
            {[
              category,
              spend !== undefined &&
                `${currency ? currency + ' ' : ''}${formatNumberCompact(spend)} spend`,
              txCount !== undefined && `${txCount} transactions`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold ${gradeClasses}`}>
            {formatEnum(grade)} · {score}/100
          </span>
          <span className={`text-xs ${trendClasses}`} title={`Trend: ${formatEnum(trend)}`}>
            {trendIcon}
          </span>
        </div>
      </div>

      {/* Compact metric chips — the actual KPI numbers the score is built from */}
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
        {otd !== undefined && <MetricChip label="On-time" value={`${otd.toFixed(1)}%`} />}
        {defect !== undefined && (
          <MetricChip label="Defects" value={`${defect.toFixed(2)}%`} />
        )}
        {invAcc !== undefined && (
          <MetricChip label="Invoice acc" value={`${invAcc.toFixed(1)}%`} />
        )}
        {fill !== undefined && <MetricChip label="Fill rate" value={`${fill.toFixed(1)}%`} />}
        {leadTime !== undefined && (
          <MetricChip label="Lead time" value={`${leadTime.toFixed(1)}d`} />
        )}
      </div>

      {issues.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-red-700">
          {issues.map((s, i) => (
            <li key={i}>⚠ {s}</li>
          ))}
        </ul>
      )}
      {positives.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-emerald-700">
          {positives.map((s, i) => (
            <li key={i}>✓ {s}</li>
          ))}
        </ul>
      )}
      {reasoning && <p className="mt-2 text-sm text-ink-700">{reasoning}</p>}
      {action && (
        <p className="mt-2 rounded bg-brand-50 px-2 py-1 text-xs text-brand-700">
          → <span className="font-medium">Recommended:</span> {action}
        </p>
      )}
      {reviewNotes && (
        <p className="mt-1 text-xs italic text-ink-500">📝 {reviewNotes}</p>
      )}
    </div>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 rounded bg-cream-100 px-1.5 py-0.5 text-ink-700">
      <span className="text-ink-500">{label}:</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}

function formatNumberCompact(n: number): string {
  // Compact: $1.2M, $34K, $542. Picks a unit suffix so cards stay
  // narrow even when spend numbers get large.
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

// ---------------------------------------------------------------------------
// Resume Screener results
// ---------------------------------------------------------------------------

/**
 * Candidate scorecard list. Header carries the role + headline counts;
 * each row below is one candidate with grade, score, top strengths /
 * gaps, suggested interview questions, and a paste-ready outreach
 * opener.
 */
function CandidatesView({ result }: { result: Record<string, unknown> }) {
  const raw = result.candidates;
  const candidates: Array<Record<string, unknown>> = Array.isArray(raw)
    ? (raw as Array<Record<string, unknown>>)
    : [];
  const total = numberOrUndef(result.totalCandidates) ?? candidates.length;
  const shortlist = numberOrUndef(result.shortlistCount);
  const review = numberOrUndef(result.reviewCount);
  const reject = numberOrUndef(result.rejectCount);
  const jobTitle = stringOr(result.jobTitle, '');
  const summary = stringOr(result.screeningSummary, '');

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-serif text-lg font-semibold text-ink-900">
          Screened {total} candidate{total === 1 ? '' : 's'}
          {jobTitle && (
            <span className="ml-2 text-sm font-normal text-ink-500">
              · {jobTitle}
            </span>
          )}
        </h3>
        {summary && <p className="mt-1 text-sm text-ink-700">{summary}</p>}
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs font-medium">
        {shortlist !== undefined && (
          <div className="rounded bg-emerald-50 px-3 py-2 text-emerald-700">
            <div className="text-lg font-bold">{shortlist}</div>
            <div>Shortlist</div>
          </div>
        )}
        {review !== undefined && (
          <div className="rounded bg-amber-50 px-3 py-2 text-amber-700">
            <div className="text-lg font-bold">{review}</div>
            <div>Review</div>
          </div>
        )}
        {reject !== undefined && (
          <div className="rounded bg-cream-200 px-3 py-2 text-ink-700">
            <div className="text-lg font-bold">{reject}</div>
            <div>Polite no</div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {candidates.map((c, i) => (
          <CandidateRow key={i} candidate={c} />
        ))}
      </div>
    </div>
  );
}

function CandidateRow({ candidate }: { candidate: Record<string, unknown> }) {
  const name = stringOr(candidate.candidateName, '—');
  const email = stringOr(candidate.email, '');
  const phone = stringOr(candidate.phone, '');
  const title = stringOr(candidate.currentTitle, '');
  const company = stringOr(candidate.currentCompany, '');
  const yrs = numberOrUndef(candidate.yearsExperience);
  const loc = stringOr(candidate.location, '');
  const score = numberOrUndef(candidate.matchScore) ?? 0;
  const grade = stringOr(candidate.grade, 'REVIEW');
  const reasoning = stringOr(candidate.reasoning, '');
  const outreach = stringOr(candidate.personalizedOutreach, '');
  const nextStep = stringOr(candidate.recommendedNextStep, '');
  const filename = stringOr(candidate.resumeFilename, '');

  const strengths = Array.isArray(candidate.keyStrengths)
    ? (candidate.keyStrengths as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  const gaps = Array.isArray(candidate.keyGaps)
    ? (candidate.keyGaps as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  const reds = Array.isArray(candidate.redFlags)
    ? (candidate.redFlags as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  const interviewQs = Array.isArray(candidate.suggestedInterviewQuestions)
    ? (candidate.suggestedInterviewQuestions as unknown[]).filter(
        (s): s is string => typeof s === 'string',
      )
    : [];

  const gradeClasses =
    grade === 'SHORTLIST'
      ? 'bg-emerald-100 text-emerald-700'
      : grade === 'REVIEW'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-ink-300/40 text-ink-700';
  const gradeLabel =
    grade === 'SHORTLIST' ? 'SHORTLIST' : grade === 'REVIEW' ? 'REVIEW' : 'POLITE NO';

  return (
    <div className="rounded-lg border bg-white p-3 transition-shadow hover:shadow-brand-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium text-ink-900">
            <span className="truncate">{name}</span>
            {filename && (
              <span className="text-xs font-normal text-ink-500">
                📄 {filename}
              </span>
            )}
          </p>
          <p className="mt-0.5 text-sm text-ink-700">
            {[
              title && company ? `${title} @ ${company}` : title || company,
              yrs !== undefined && `${yrs.toFixed(yrs % 1 === 0 ? 0 : 1)} yrs exp`,
              loc,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {(email || phone) && (
            <p className="mt-0.5 text-xs text-ink-500">
              {[email, phone].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold ${gradeClasses}`}>
          {gradeLabel} · {score}/100
        </span>
      </div>

      {strengths.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">
            Strengths
          </p>
          <ul className="mt-0.5 space-y-0.5 text-xs text-ink-700">
            {strengths.map((s, i) => (
              <li key={i}>✓ {s}</li>
            ))}
          </ul>
        </div>
      )}

      {gaps.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-amber-700">
            Gaps
          </p>
          <ul className="mt-0.5 space-y-0.5 text-xs text-ink-700">
            {gaps.map((s, i) => (
              <li key={i}>· {s}</li>
            ))}
          </ul>
        </div>
      )}

      {reds.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-red-700">
            Red flags
          </p>
          <ul className="mt-0.5 space-y-0.5 text-xs text-red-700">
            {reds.map((s, i) => (
              <li key={i}>⚠ {s}</li>
            ))}
          </ul>
        </div>
      )}

      {reasoning && <p className="mt-2 text-sm text-ink-700">{reasoning}</p>}

      {interviewQs.length > 0 && (
        <details className="mt-2 group">
          <summary className="cursor-pointer text-xs font-medium text-brand-600 hover:text-brand-700">
            Suggested interview questions ({interviewQs.length})
          </summary>
          <ol className="mt-1.5 ml-4 list-decimal space-y-1 text-xs text-ink-700">
            {interviewQs.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </details>
      )}

      {outreach && (
        <p className="mt-2 rounded bg-brand-50 px-2 py-1 text-xs text-brand-700">
          💬 {outreach}
        </p>
      )}
      {nextStep && (
        <p className="mt-1 text-xs italic text-ink-500">→ {nextStep}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Churn Risk results
// ---------------------------------------------------------------------------

/**
 * Per-account churn-risk view. Layout mirrors the other Level-4
 * outputs (Invoice Auditor / GCC Prospector): plan card at top,
 * stat strip, per-account rows with expandable retention email +
 * follow-up questions, cross-portfolio insights + self-review at
 * the bottom.
 */
function AccountsView({ result }: { result: Record<string, unknown> }) {
  const raw = result.accounts;
  const accounts: Array<Record<string, unknown>> = Array.isArray(raw)
    ? (raw as Array<Record<string, unknown>>)
    : [];
  const total = numberOrUndef(result.totalAccounts) ?? accounts.length;
  const churn = numberOrUndef(result.churnRiskCount);
  const watch = numberOrUndef(result.watchCount);
  const healthy = numberOrUndef(result.healthyCount);
  const arrAtRisk = numberOrUndef(result.arrAtRisk);
  const health = numberOrUndef(result.portfolioHealthScore);
  const summary = stringOr(result.executiveSummary, '');
  const plan = stringOr(result.agentPlan, '');
  const selfReview = stringOr(result.selfReviewNotes, '');

  const drivers = Array.isArray(result.topChurnDrivers)
    ? (result.topChurnDrivers as unknown[]).filter(
        (s): s is string => typeof s === 'string',
      )
    : [];
  const playDist = Array.isArray(result.savePlayDistribution)
    ? (result.savePlayDistribution as Array<Record<string, unknown>>).filter(
        (p): p is Record<string, unknown> => p && typeof p === 'object',
      )
    : [];

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-serif text-lg font-semibold text-ink-900">
          Triaged {total} account{total === 1 ? '' : 's'}
          {arrAtRisk !== undefined && arrAtRisk > 0 && (
            <span className="ml-2 text-sm font-normal text-red-700">
              · {formatNumberCompact(arrAtRisk)} ARR at risk
            </span>
          )}
        </h3>
        {summary && <p className="mt-1 text-sm text-ink-700">{summary}</p>}
      </div>

      {plan && (
        <div className="rounded-lg border border-brand-100 bg-brand-gradient-soft p-3 text-sm text-ink-900">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-brand-700">
            🤖 Agent plan
          </p>
          <p className="leading-relaxed">{plan}</p>
        </div>
      )}

      <div className="grid grid-cols-4 gap-2 text-xs font-medium">
        {health !== undefined && (
          <div className="rounded bg-brand-gradient px-3 py-2 text-white">
            <div className="text-lg font-bold">{health}</div>
            <div>Portfolio health</div>
          </div>
        )}
        {churn !== undefined && (
          <div className="rounded bg-red-50 px-3 py-2 text-red-700">
            <div className="text-lg font-bold">{churn}</div>
            <div>Churn risk</div>
          </div>
        )}
        {watch !== undefined && (
          <div className="rounded bg-amber-50 px-3 py-2 text-amber-700">
            <div className="text-lg font-bold">{watch}</div>
            <div>Watch</div>
          </div>
        )}
        {healthy !== undefined && (
          <div className="rounded bg-emerald-50 px-3 py-2 text-emerald-700">
            <div className="text-lg font-bold">{healthy}</div>
            <div>Healthy</div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {accounts.map((a, i) => (
          <AccountRow key={i} account={a} />
        ))}
      </div>

      {drivers.length > 0 && (
        <div className="rounded-lg border border-brand-100 bg-brand-50 p-3">
          <p className="mb-2 text-sm font-semibold text-brand-700">
            🔭 Top churn drivers across the portfolio
          </p>
          <ul className="space-y-1 text-sm text-ink-900">
            {drivers.map((s, i) => (
              <li key={i}>• {s}</li>
            ))}
          </ul>
        </div>
      )}

      {playDist.length > 0 && (
        <div className="rounded-lg border border-cream-200 bg-white p-3">
          <p className="mb-2 text-sm font-semibold text-ink-900">
            🛟 Save-play distribution
          </p>
          <ul className="space-y-1 text-sm text-ink-700">
            {playDist.map((p, i) => {
              const play = stringOr(p.play, '');
              const count = numberOrUndef(p.accountCount) ?? 0;
              return (
                <li key={i} className="flex items-baseline justify-between gap-3">
                  <span>{play}</span>
                  <span className="font-medium text-ink-900">
                    {count} {count === 1 ? 'account' : 'accounts'}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {selfReview && (
        <div className="rounded-lg border border-cream-200 bg-white p-3">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-500">
            🪞 Agent self-review
          </p>
          <p className="text-sm italic text-ink-700">{selfReview}</p>
        </div>
      )}
    </div>
  );
}

function AccountRow({ account }: { account: Record<string, unknown> }) {
  const name = stringOr(account.accountName, '—');
  const accountId = stringOr(account.accountId, '');
  const tier = stringOr(account.tier, '');
  const arr = numberOrUndef(account.arr);
  const renewalDays = numberOrUndef(account.contractRenewalDays);
  const score = numberOrUndef(account.churnRiskScore) ?? 0;
  const grade = stringOr(account.grade, 'WATCH');
  const confidence = numberOrUndef(account.confidence);
  const isStrategic = Boolean(account.isStrategic);
  const isEscalation = Boolean(account.isEscalation);
  const lastEngagement = stringOr(account.lastEngagement, '');
  const play = stringOr(account.recommendedPlay, '');
  const email = stringOr(account.retentionEmail, '');
  const escalateTo = stringOr(account.escalateTo, '');
  const reasoning = stringOr(account.reasoning, '');

  const drivers = Array.isArray(account.riskDrivers)
    ? (account.riskDrivers as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  const positives = Array.isArray(account.positives)
    ? (account.positives as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  const followUps = Array.isArray(account.followUpQuestions)
    ? (account.followUpQuestions as unknown[]).filter(
        (s): s is string => typeof s === 'string',
      )
    : [];

  const gradeClasses =
    grade === 'CHURN_RISK'
      ? 'bg-red-100 text-red-700'
      : grade === 'WATCH'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-emerald-100 text-emerald-700';
  const gradeLabel =
    grade === 'CHURN_RISK'
      ? 'CHURN RISK'
      : grade === 'WATCH'
        ? 'WATCH'
        : 'HEALTHY';

  const confidenceClasses =
    confidence === undefined
      ? 'text-ink-500'
      : confidence >= 85
        ? 'text-emerald-700'
        : confidence >= 70
          ? 'text-amber-700'
          : 'text-red-700';

  return (
    <div className="rounded-lg border bg-white p-3 transition-shadow hover:shadow-brand-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium text-ink-900">
            <span className="truncate">{name}</span>
            {accountId && (
              <span className="text-xs font-normal text-ink-500">#{accountId}</span>
            )}
            {isStrategic && (
              <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">
                strategic
              </span>
            )}
            {isEscalation && (
              <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                escalation trigger
              </span>
            )}
          </p>
          <p className="mt-0.5 text-sm text-ink-700">
            {[
              tier,
              arr !== undefined && `${formatNumberCompact(arr)} ARR`,
              renewalDays !== undefined &&
                (renewalDays <= 0
                  ? 'renewal overdue'
                  : `renewal in ${renewalDays}d`),
              lastEngagement && `last touch: ${lastEngagement}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold ${gradeClasses}`}>
            {gradeLabel} · {score}/100
          </span>
          {confidence !== undefined && (
            <span
              className={`text-[11px] font-medium ${confidenceClasses}`}
              title="How thoroughly the agent verified this risk. <70 = data was thin; CSM should sanity-check."
            >
              {confidence}% confidence
            </span>
          )}
        </div>
      </div>

      {drivers.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-red-700">
            Risk drivers
          </p>
          <ul className="mt-0.5 space-y-0.5 text-xs text-ink-700">
            {drivers.map((s, i) => (
              <li key={i}>⚠ {s}</li>
            ))}
          </ul>
        </div>
      )}

      {positives.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">
            Working in your favor
          </p>
          <ul className="mt-0.5 space-y-0.5 text-xs text-ink-700">
            {positives.map((s, i) => (
              <li key={i}>✓ {s}</li>
            ))}
          </ul>
        </div>
      )}

      {reasoning && <p className="mt-2 text-sm text-ink-700">{reasoning}</p>}

      {play && (
        <div className="mt-2 rounded border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-xs">
          <span className="font-medium text-brand-700">
            🛟 Recommended save play:
          </span>{' '}
          <span className="text-ink-900">{play}</span>
          {escalateTo && (
            <span className="ml-2 text-ink-500">→ escalate to {escalateTo}</span>
          )}
        </div>
      )}

      {email && (
        <details className="mt-2 rounded border border-brand-100 bg-brand-50/40 px-2.5 py-1.5 text-xs">
          <summary className="cursor-pointer font-medium text-brand-700">
            ✉ Draft retention email — paste-ready
          </summary>
          <pre className="mt-1.5 whitespace-pre-wrap font-sans text-xs text-ink-700">
            {email}
          </pre>
        </details>
      )}

      {followUps.length > 0 && (
        <details className="mt-2 group">
          <summary className="cursor-pointer text-xs font-medium text-ink-700 hover:text-brand-600">
            Questions for the next CSM conversation ({followUps.length})
          </summary>
          <ol className="mt-1.5 ml-4 list-decimal space-y-1 text-xs text-ink-700">
            {followUps.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sales Proposal Writer
// ---------------------------------------------------------------------------

function ProposalView({ result }: { result: Record<string, unknown> }) {
  const plan = stringOr(result.agentPlan, '');
  const title = stringOr(result.proposalTitle, 'Proposal');
  const recipientName = stringOr(result.recipientName, '');
  const recipientCompany = stringOr(result.recipientCompany, '');
  const execSummary = stringOr(result.executiveSummary, '');
  const problem = stringOr(result.problemUnderstanding, '');
  const coverEmail = stringOr(result.coverEmail, '');
  const altApproach = stringOr(result.alternativeApproach, '');
  const selfReview = stringOr(result.selfReviewNotes, '');
  const pricingNotes = stringOr(result.pricingNotes, '');
  const discountReason = stringOr(result.appliedDiscountReason, '');

  const winProb = numberOrUndef(result.estimatedWinProbability);
  const confidence = numberOrUndef(result.confidence);
  const pricingTotal = numberOrUndef(result.pricingTotal);
  const discountPct = numberOrUndef(result.appliedDiscountPercent);
  const currency = stringOr(result.pricingCurrency, 'USD');

  const scope = Array.isArray(result.proposedScope)
    ? (result.proposedScope as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  const assumptions = Array.isArray(result.assumptions)
    ? (result.assumptions as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  const whyUs = Array.isArray(result.whyUs)
    ? (result.whyUs as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  const nextSteps = Array.isArray(result.nextSteps)
    ? (result.nextSteps as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  const gaps = Array.isArray(result.gapsToFollowUp)
    ? (result.gapsToFollowUp as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  const pricingTable = Array.isArray(result.pricingTable)
    ? (result.pricingTable as Array<Record<string, unknown>>).filter(
        (r): r is Record<string, unknown> => r && typeof r === 'object',
      )
    : [];
  const timeline = Array.isArray(result.timeline)
    ? (result.timeline as Array<Record<string, unknown>>).filter(
        (r): r is Record<string, unknown> => r && typeof r === 'object',
      )
    : [];
  const risks = Array.isArray(result.risks)
    ? (result.risks as Array<Record<string, unknown>>).filter(
        (r): r is Record<string, unknown> => r && typeof r === 'object',
      )
    : [];

  // Win-probability + confidence color tiers — mirror the language
  // used in the agent's own scoring rubric.
  const winClasses =
    winProb === undefined
      ? 'bg-cream-200 text-ink-700'
      : winProb >= 70
        ? 'bg-emerald-100 text-emerald-700'
        : winProb >= 40
          ? 'bg-amber-100 text-amber-800'
          : 'bg-red-100 text-red-700';
  const confidenceClasses =
    confidence === undefined
      ? 'text-ink-500'
      : confidence >= 85
        ? 'text-emerald-700'
        : confidence >= 70
          ? 'text-amber-700'
          : 'text-red-700';

  return (
    <div className="space-y-3">
      {/* ---- Header: title + recipient + the agent's win-probability call ---- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-lg font-semibold text-ink-900">{title}</h3>
          {(recipientName || recipientCompany) && (
            <p className="mt-0.5 text-sm text-ink-700">
              {recipientName && <>For <span className="font-medium">{recipientName}</span></>}
              {recipientName && recipientCompany && ' · '}
              {recipientCompany && <span>{recipientCompany}</span>}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          {winProb !== undefined && (
            <span
              className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold ${winClasses}`}
              title="Agent's honest estimate of close probability based on the brief's strength of fit, budget signal, and urgency."
            >
              {winProb}% win probability
            </span>
          )}
          {confidence !== undefined && (
            <span
              className={`text-[11px] font-medium ${confidenceClasses}`}
              title="How thoroughly the proposal is backed by the brief + catalog. <70 = agent had to assume; review gaps before sending."
            >
              {confidence}% confidence
            </span>
          )}
        </div>
      </div>

      {plan && (
        <div className="rounded-lg border border-brand-100 bg-brand-gradient-soft p-3 text-sm text-ink-900">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-brand-700">
            🤖 Agent plan
          </p>
          <p className="leading-relaxed">{plan}</p>
        </div>
      )}

      {execSummary && (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-500">
            Executive summary
          </p>
          <p className="text-sm leading-relaxed text-ink-900">{execSummary}</p>
        </div>
      )}

      {problem && (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-500">
            Understanding of the problem
          </p>
          <p className="text-sm leading-relaxed text-ink-700">{problem}</p>
        </div>
      )}

      {scope.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-500">
            Proposed scope
          </p>
          <ul className="space-y-1 text-sm text-ink-900">
            {scope.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-brand-500">▸</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pricingTable.length > 0 && (
        <div className="rounded-lg border border-cream-200 bg-white p-3">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-ink-900">💰 Pricing</p>
            {pricingTotal !== undefined && pricingTotal > 0 && (
              <p className="text-sm font-semibold text-brand-700">
                {currency} {formatNumberCompact(pricingTotal)}
              </p>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-ink-500">
                <tr className="border-b border-cream-200 text-left">
                  <th className="py-1 pr-3 font-medium">Item</th>
                  <th className="py-1 pr-3 font-medium">Qty</th>
                  <th className="py-1 pr-3 font-medium">Unit</th>
                  <th className="py-1 pr-3 text-right font-medium">Unit price</th>
                  <th className="py-1 text-right font-medium">Line total</th>
                </tr>
              </thead>
              <tbody>
                {pricingTable.map((row, i) => {
                  const desc = stringOr(row.description, '—');
                  const qty = numberOrUndef(row.quantity);
                  const unit = stringOr(row.unit, '');
                  const unitPrice = numberOrUndef(row.unitPrice);
                  const lineTotal = numberOrUndef(row.lineTotal);
                  const notes = stringOr(row.notes, '');
                  return (
                    <tr key={i} className="border-b border-cream-100 last:border-0 align-top">
                      <td className="py-1.5 pr-3 text-ink-900">
                        {desc}
                        {notes && (
                          <span className="mt-0.5 block text-[11px] italic text-ink-500">
                            {notes}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-ink-700">{qty ?? '—'}</td>
                      <td className="py-1.5 pr-3 text-ink-700">{unit || '—'}</td>
                      <td className="py-1.5 pr-3 text-right text-ink-700">
                        {unitPrice !== undefined ? formatUSD(unitPrice) : '—'}
                      </td>
                      <td className="py-1.5 text-right font-medium text-ink-900">
                        {lineTotal !== undefined ? formatUSD(lineTotal) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pricingNotes && (
            <p className="mt-2 text-[11px] italic text-ink-500">{pricingNotes}</p>
          )}
          {discountPct !== undefined && discountPct > 0 && (
            <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
              ⚠ Applied {discountPct}% discount
              {discountReason && <> — {discountReason}</>}
            </p>
          )}
        </div>
      )}

      {timeline.length > 0 && (
        <div className="rounded-lg border border-cream-200 bg-white p-3">
          <p className="mb-2 text-sm font-semibold text-ink-900">🗓 Timeline</p>
          <ol className="space-y-1.5 text-sm text-ink-900">
            {timeline.map((m, i) => {
              const name = stringOr(m.name, `Milestone ${i + 1}`);
              const weeks = numberOrUndef(m.durationWeeks);
              const deliverable = stringOr(m.deliverable, '');
              return (
                <li key={i} className="flex gap-3">
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-semibold text-brand-700">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {name}
                      {weeks !== undefined && (
                        <span className="ml-2 text-xs font-normal text-ink-500">
                          {weeks} {weeks === 1 ? 'week' : 'weeks'}
                        </span>
                      )}
                    </p>
                    {deliverable && (
                      <p className="text-xs text-ink-700">{deliverable}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {whyUs.length > 0 && (
        <div className="rounded-lg border border-brand-100 bg-brand-50 p-3">
          <p className="mb-1 text-sm font-semibold text-brand-700">⭐ Why us</p>
          <ul className="space-y-1 text-sm text-ink-900">
            {whyUs.map((s, i) => (
              <li key={i}>• {s}</li>
            ))}
          </ul>
        </div>
      )}

      {assumptions.length > 0 && (
        <div className="rounded-lg border border-cream-200 bg-cream-50 p-3">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-500">
            Assumptions
          </p>
          <ul className="space-y-0.5 text-xs text-ink-700">
            {assumptions.map((s, i) => (
              <li key={i}>• {s}</li>
            ))}
          </ul>
        </div>
      )}

      {risks.length > 0 && (
        <div className="rounded-lg border border-cream-200 bg-white p-3">
          <p className="mb-2 text-sm font-semibold text-ink-900">⚠ Risks + mitigations</p>
          <ul className="space-y-1.5 text-sm">
            {risks.map((r, i) => {
              const risk = stringOr(r.risk, '');
              const mitigation = stringOr(r.mitigation, '');
              return (
                <li key={i} className="rounded bg-amber-50 px-2 py-1.5">
                  <p className="font-medium text-amber-900">{risk}</p>
                  {mitigation && (
                    <p className="mt-0.5 text-xs text-ink-700">
                      <span className="font-medium text-emerald-700">Mitigation:</span>{' '}
                      {mitigation}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {nextSteps.length > 0 && (
        <div className="rounded-lg border border-cream-200 bg-white p-3">
          <p className="mb-1 text-sm font-semibold text-ink-900">→ Next steps</p>
          <ol className="ml-4 list-decimal space-y-0.5 text-sm text-ink-900">
            {nextSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}

      {coverEmail && (
        <details className="rounded-lg border border-brand-200 bg-brand-50/40 p-3" open>
          <summary className="cursor-pointer text-sm font-semibold text-brand-700">
            ✉ Paste-ready cover email
          </summary>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-900">
            {coverEmail}
          </pre>
        </details>
      )}

      {altApproach && (
        <div className="rounded-lg border border-brand-100 bg-brand-50 p-3">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-brand-700">
            🔄 Alternative approach (if they push back)
          </p>
          <p className="text-sm italic text-ink-900">{altApproach}</p>
        </div>
      )}

      {gaps.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="mb-1 text-sm font-semibold text-amber-900">
            ❓ Ask the prospect before sending
          </p>
          <ul className="space-y-0.5 text-sm text-ink-900">
            {gaps.map((s, i) => (
              <li key={i}>• {s}</li>
            ))}
          </ul>
        </div>
      )}

      {selfReview && (
        <div className="rounded-lg border border-cream-200 bg-white p-3">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-500">
            🪞 Agent self-review
          </p>
          <p className="text-sm italic text-ink-700">{selfReview}</p>
        </div>
      )}
    </div>
  );
}

function GenericJsonView({ result }: { result: Record<string, unknown> }) {
  return (
    <pre className="max-h-96 overflow-auto rounded bg-cream-50 p-3 text-xs text-ink-700">
      {JSON.stringify(result, null, 2)}
    </pre>
  );
}

// ---------------------------------------------------------------------------
// Gate form (rendered inline in the chat when gated:true)
// ---------------------------------------------------------------------------

export function GateForm({
  gate,
  remaining,
  onSubmit,
  busy,
}: {
  gate: PublicAgentConfig['gate'];
  remaining: number;
  onSubmit: (values: Record<string, string>) => void;
  busy?: boolean;
}) {
  const message = gate.message.replace('{remaining}', String(remaining));

  return (
    <div className="rounded-xl border border-brand-100 bg-brand-50 p-4">
      <p className="mb-3 text-center text-sm font-medium text-brand-700">🔒 {message}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          const formData = new FormData(e.currentTarget);
          const values = Object.fromEntries(formData) as Record<string, string>;
          onSubmit(values);
        }}
        className="space-y-2"
      >
        {gate.fields.map((field) => (
          <div key={field.name}>
            {field.type === 'select' ? (
              <select
                name={field.name}
                required={field.required}
                disabled={busy}
                className="w-full rounded-lg border bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 disabled:bg-cream-200"
                defaultValue=""
              >
                <option value="" disabled>
                  {field.label}
                </option>
                {(field.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={field.type}
                name={field.name}
                placeholder={field.label}
                required={field.required}
                disabled={busy}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 disabled:bg-cream-200"
              />
            )}
          </div>
        ))}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-brand-gradient py-2.5 text-sm font-medium text-white shadow-brand-cta transition-shadow hover:shadow-brand-cta-hover disabled:cursor-wait disabled:bg-none disabled:bg-brand-300 disabled:shadow-none"
        >
          {busy ? 'Unlocking…' : gate.ctaText}
        </button>
      </form>
      <p className="mt-2 text-center text-xs text-ink-500">No spam. Unsubscribe anytime.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------

function numberOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function stringOr(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}
function formatEnum(s: string): string {
  return s
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}
function formatUSD(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}
