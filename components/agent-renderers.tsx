'use client';

/**
 * Shared per-agent result + trace renderers.
 *
 * Both the legacy `AgentCard` widget and the new `AgentChat` interface
 * pull from this file. Keeping the visual primitives in one place means a
 * tweak to the lead row layout (or the workflow timeline) lands in both
 * surfaces without copy-paste drift.
 *
 * Adding a new agent? Add a `case` in `ResultsBody` plus a small view
 * component below. The chat and card both pick it up automatically.
 */
import { useMemo, useState } from 'react';
import type {
  PublicAgentConfig,
  ToolCallRecord,
  WorkflowStepRecord,
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
    default:
      return <GenericJsonView result={result} />;
  }
}

// ---------------------------------------------------------------------------
// Workflow trace timeline (Level-3 agents)
// ---------------------------------------------------------------------------

/**
 * Vertical step timeline with click-to-expand per-step detail.
 *
 * Why this gets its own component (not part of the result body):
 *   The trace is *meta* — it shows how the answer was produced, not the
 *   answer itself. Visitors want both: the timeline as proof-of-Level-3
 *   work, and the result as the actual deliverable. Keeping them as
 *   sibling components in the chat message also lets the chat decide
 *   when to fold the trace into a collapsed summary (post-result UX).
 */
export function WorkflowTraceView({ trace }: { trace: WorkflowStepRecord[] }) {
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  const completed = trace.filter((s) => s.status === 'completed').length;
  const skipped = trace.filter((s) => s.status === 'skipped').length;
  const totalMs = trace.reduce((n, s) => n + s.durationMs, 0);

  return (
    <div className="rounded-lg border border-purple-100 bg-purple-50/40 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm">
        <span className="text-purple-600">⚙️</span>
        <span className="font-medium text-purple-900">
          Workflow: {completed}/{trace.length} step{trace.length === 1 ? '' : 's'} completed
          {skipped > 0 && <span className="text-purple-600"> · {skipped} skipped</span>}
        </span>
        {totalMs > 0 && (
          <span className="text-xs text-purple-500">· {(totalMs / 1000).toFixed(1)}s</span>
        )}
      </div>

      <ol className="space-y-1.5">
        {trace.map((step, i) => {
          const isExpanded = expandedStep === step.id;
          const hasToolCalls = (step.toolCalls?.length ?? 0) > 0;
          const isClickable = hasToolCalls || Boolean(step.description);
          return (
            <li key={step.id}>
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => setExpandedStep(isExpanded ? null : step.id)}
                className={`group flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
                  isClickable ? 'hover:bg-purple-100/50' : ''
                }`}
              >
                <StepIcon status={step.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-800">
                      {i + 1}. {step.name}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-gray-500">
                      {hasToolCalls && (
                        <span className="rounded bg-indigo-100 px-1.5 text-indigo-700">
                          🔧 {step.toolCalls!.length}
                        </span>
                      )}
                      {step.modelTokens !== undefined && step.modelTokens > 0 && (
                        <span>{step.modelTokens.toLocaleString()} tok</span>
                      )}
                      {step.durationMs > 0 && (
                        <span>{(step.durationMs / 1000).toFixed(1)}s</span>
                      )}
                    </span>
                  </div>
                  <p
                    className={`mt-0.5 text-xs ${
                      step.status === 'failed'
                        ? 'text-red-700'
                        : step.status === 'skipped'
                          ? 'text-gray-500 italic'
                          : 'text-gray-600'
                    }`}
                  >
                    {step.summary}
                  </p>
                </div>
              </button>

              {isExpanded && (
                <div className="ml-8 mt-1 space-y-1 border-l-2 border-purple-200 pl-3">
                  {step.description && (
                    <p className="text-xs text-gray-500">{step.description}</p>
                  )}
                  {step.toolCalls?.map((t, j) => (
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

function StepIcon({ status }: { status: WorkflowStepRecord['status'] }) {
  const map: Record<
    WorkflowStepRecord['status'],
    { char: string; classes: string; label: string }
  > = {
    completed: { char: '✓', classes: 'bg-green-100 text-green-700', label: 'Completed' },
    skipped: { char: '⊘', classes: 'bg-gray-100 text-gray-500', label: 'Skipped' },
    failed: { char: '✕', classes: 'bg-red-100 text-red-700', label: 'Failed' },
    pending: { char: '…', classes: 'bg-gray-100 text-gray-400', label: 'Pending' },
    running: {
      char: '◌',
      classes: 'bg-blue-100 text-blue-700 animate-pulse',
      label: 'Running',
    },
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
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-2 text-sm">
          <span className="text-indigo-600">🔧</span>
          <span className="font-medium text-indigo-900">
            Agent made {trace.length} tool call{trace.length === 1 ? '' : 's'}
          </span>
          <span className="text-xs text-indigo-700">
            {counts
              .map(([t, { ok, failed }]) =>
                failed > 0 ? `${t} (${ok}✓ ${failed}✗)` : `${t} (${ok})`,
              )
              .join(' · ')}
          </span>
          {totalMs > 0 && (
            <span className="text-xs text-indigo-500">· {(totalMs / 1000).toFixed(1)}s</span>
          )}
        </div>
        <span className="text-xs text-indigo-600">{expanded ? 'Hide' : 'Show'}</span>
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
          : 'border-indigo-100 bg-white text-gray-700'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono font-medium">
          {idx != null ? `${idx}. ` : ''}
          {t.tool}
        </span>
        {t.durationMs > 0 && <span className="text-gray-400">{t.durationMs}ms</span>}
      </div>
      <div className="mt-0.5 truncate font-mono text-gray-500">{JSON.stringify(t.args)}</div>
      <div className={`mt-0.5 ${t.failed ? 'text-red-700' : 'text-indigo-700'}`}>
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
        <h3 className="font-semibold text-gray-800">
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
        : 'bg-gray-100 text-gray-600';

  return (
    <div className="rounded-lg border bg-white p-3 transition-shadow hover:shadow-sm">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="truncate font-medium text-gray-800">{name}</p>
          {email && <p className="truncate text-sm text-gray-500">{email}</p>}
        </div>
        <div className={`rounded-full px-3 py-1 text-xs font-bold ${gradeClasses}`}>
          {grade} · {score}/100
        </div>
      </div>
      {reasoning && <p className="mt-2 text-sm text-gray-600">{reasoning}</p>}
      {outreach && <p className="mt-1 text-xs text-indigo-600">💬 {outreach}</p>}
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
  const savings = numberOrUndef(result.potentialSavingsUSD);
  const totalValue = numberOrUndef(result.totalValueUSD);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-semibold text-gray-800">
          Audited {total} invoice{total === 1 ? '' : 's'}
          {totalValue !== undefined && (
            <span className="ml-2 text-sm font-normal text-gray-500">
              · {formatUSD(totalValue)} total
            </span>
          )}
        </h3>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs font-medium">
        {autoApprove !== undefined && (
          <div className="rounded bg-green-100 px-3 py-2 text-green-800">
            <div className="text-lg font-bold">{autoApprove}</div>
            <div>Auto-approve</div>
          </div>
        )}
        {needsReview !== undefined && (
          <div className="rounded bg-yellow-100 px-3 py-2 text-yellow-800">
            <div className="text-lg font-bold">{needsReview}</div>
            <div>Needs review</div>
          </div>
        )}
        {rejected !== undefined && (
          <div className="rounded bg-red-100 px-3 py-2 text-red-800">
            <div className="text-lg font-bold">{rejected}</div>
            <div>Rejected</div>
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
  const reasoning = stringOr(invoice.reasoning, '');
  const suggestedAction = stringOr(invoice.suggestedAction, '');
  const discrepancies = Array.isArray(invoice.discrepancies)
    ? (invoice.discrepancies as unknown[]).filter((d): d is string => typeof d === 'string')
    : [];

  const decisionClasses =
    decision === 'AUTO_APPROVE'
      ? 'bg-green-100 text-green-700'
      : decision === 'REJECT'
        ? 'bg-red-100 text-red-700'
        : decision === 'ROUTE_TO_CFO'
          ? 'bg-purple-100 text-purple-700'
          : 'bg-yellow-100 text-yellow-700';
  const matchClasses =
    matchStatus === 'EXACT'
      ? 'text-green-600'
      : matchStatus === 'WITHIN_TOLERANCE'
        ? 'text-emerald-600'
        : matchStatus === 'VARIANCE' || matchStatus === 'DUPLICATE'
          ? 'text-red-600'
          : 'text-gray-500';

  return (
    <div className="rounded-lg border bg-white p-3 transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-gray-800">
            {invoiceNumber}
            <span className="ml-2 text-sm font-normal text-gray-500">{vendor}</span>
          </p>
          <p className="mt-0.5 text-sm text-gray-600">
            {amount !== undefined && (
              <span className="font-medium">
                {currency === 'USD'
                  ? formatUSD(amount)
                  : `${currency} ${amount.toFixed(2)}`}
              </span>
            )}
            {poNumber && (
              <>
                <span className="mx-2 text-gray-300">·</span>
                <span>PO {poNumber}</span>
              </>
            )}
            <span className="mx-2 text-gray-300">·</span>
            <span className={matchClasses}>{formatEnum(matchStatus)}</span>
          </p>
        </div>
        <div
          className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${decisionClasses}`}
        >
          {formatEnum(decision)}
        </div>
      </div>
      {discrepancies.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-red-700">
          {discrepancies.map((d, i) => (
            <li key={i}>⚠ {d}</li>
          ))}
        </ul>
      )}
      {reasoning && <p className="mt-2 text-sm text-gray-600">{reasoning}</p>}
      {suggestedAction && (
        <p className="mt-1 text-xs text-indigo-600">→ {suggestedAction}</p>
      )}
    </div>
  );
}

function GenericJsonView({ result }: { result: Record<string, unknown> }) {
  return (
    <pre className="max-h-96 overflow-auto rounded bg-gray-50 p-3 text-xs text-gray-700">
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
    <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
      <p className="mb-3 text-center text-sm font-medium text-indigo-900">🔒 {message}</p>
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
                className="w-full rounded-lg border bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
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
                className="w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
              />
            )}
          </div>
        ))}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-wait disabled:bg-indigo-400"
        >
          {busy ? 'Unlocking…' : gate.ctaText}
        </button>
      </form>
      <p className="mt-2 text-center text-xs text-gray-500">No spam. Unsubscribe anytime.</p>
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
