'use client';

/**
 * AgentCard — the reusable visitor-facing widget.
 *
 * Lifecycle:
 *   idle       → dropzones (one per slot) + optional context textarea
 *   processing → spinner while the one-shot generateObject call runs (~10-15s)
 *   gated      → teaser visible, full result hidden behind email form
 *   unlocked   → full result shown
 *   error      → something broke; retry button
 *
 * Multi-slot inputs (e.g., Invoice Auditor's invoices + POs): each slot
 * renders its own `FileSlotDropzone` sub-component so `useDropzone` can be
 * called once per slot (hooks can't live in a loop). The parent holds a
 * `filesBySlot` map keyed by `slot.key` and submits explicitly via the
 * Run button once all required slots have files.
 *
 * We used to stream NDJSON for progressive UI, but the streaming fetch
 * hangs on some Windows setups (security tools intercepting SSE). The
 * server now does a one-shot call and returns JSON.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import type {
  FileSlot,
  PublicAgentConfig,
  ToolCallRecord,
  WorkflowStepRecord,
} from '@/lib/agents/types';

type Status = 'loading-config' | 'idle' | 'processing' | 'gated' | 'unlocked' | 'error';

interface AgentCardProps {
  slug: string;
  /** True when rendered inside an iframe embed — hides the footer chrome. */
  embedded?: boolean;
}

export default function AgentCard({ slug, embedded = false }: AgentCardProps) {
  const [config, setConfig] = useState<PublicAgentConfig | null>(null);
  const [status, setStatus] = useState<Status>('loading-config');
  const [errorMessage, setErrorMessage] = useState('');
  /** Visitor-supplied freeform context (ICP, audit rules, etc.). Empty
   *  string when the agent has no contextInput configured. */
  const [contextValue, setContextValue] = useState('');

  // Files staged per slot key before submit. Drop fills a slot, Run submits.
  // Keyed by FileSlot.key so we can post each slot under its own form-data
  // field name without touching the route.
  const [filesBySlot, setFilesBySlot] = useState<Record<string, File[]>>({});

  // The server returns the teaser immediately and the full result on unlock.
  // `displayedResult` holds whichever one is currently showing.
  const [displayedResult, setDisplayedResult] = useState<Record<string, unknown> | null>(
    null,
  );
  const [remaining, setRemaining] = useState(0);
  const [sessionId, setSessionId] = useState('');
  /** Tool-call trace from the research phase. Empty array for single-shot
   *  agents. Surfaced as a badge + expandable detail in the results view. */
  const [toolTrace, setToolTrace] = useState<ToolCallRecord[]>([]);
  /** Per-step workflow trace for Level-3 agents. Empty for L1/L2 agents.
   *  Surfaced as a vertical timeline above the tool trace. */
  const [workflowTrace, setWorkflowTrace] = useState<WorkflowStepRecord[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // --- Load agent config --------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/agents/${slug}/config`)
      .then((r) => {
        if (!r.ok) throw new Error(`Config load failed (${r.status})`);
        return r.json();
      })
      .then((data: PublicAgentConfig) => {
        if (cancelled) return;
        setConfig(data);
        setStatus('idle');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : String(error));
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const setSlotFiles = useCallback((key: string, files: File[]) => {
    setFilesBySlot((prev) => ({ ...prev, [key]: files }));
  }, []);

  // All required slots filled + any required context filled → ready to run.
  // We evaluate this each render from state, not from a memo, so the button
  // flips the instant the last slot gets a file.
  const canSubmit = useMemo(() => {
    if (!config) return false;
    for (const slot of config.fileSlots) {
      const required = slot.required !== false;
      const count = filesBySlot[slot.key]?.length ?? 0;
      if (required && count === 0) return false;
    }
    if (config.contextInput?.required && !contextValue.trim()) return false;
    return true;
  }, [config, filesBySlot, contextValue]);

  // --- Submit → POST /process --------------------------------------------
  const runAgent = useCallback(async () => {
    if (!config || !canSubmit) return;
    setStatus('processing');
    setDisplayedResult(null);
    setErrorMessage('');

    const formData = new FormData();
    for (const slot of config.fileSlots) {
      const arr = filesBySlot[slot.key] ?? [];
      for (const file of arr) formData.append(slot.key, file);
    }
    // Always append `context` — the server treats empty string as "not
    // provided" and falls back to the agent's generic defaults.
    formData.append('context', contextValue);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`/api/agents/${slug}/process`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      const body = (await safeJson(response)) as
        | {
            sessionId?: string;
            teaser?: Record<string, unknown>;
            remaining?: number;
            gated?: boolean;
            toolTrace?: ToolCallRecord[];
            workflowTrace?: WorkflowStepRecord[];
            error?: string;
          }
        | null;

      if (!response.ok) {
        // On failure, the route may still return partial traces — show
        // them so the visitor can see "step 3 failed: …" instead of
        // staring at a blank error card.
        if (body?.workflowTrace?.length || body?.toolTrace?.length) {
          setWorkflowTrace(body.workflowTrace ?? []);
          setToolTrace(body.toolTrace ?? []);
        }
        throw new Error(body?.error ?? `Processing failed (${response.status})`);
      }
      if (!body || !body.teaser) {
        throw new Error('Agent returned no result. Check the dev-server logs.');
      }

      setSessionId(body.sessionId ?? '');
      setDisplayedResult(body.teaser);
      setRemaining(body.remaining ?? 0);
      setToolTrace(Array.isArray(body.toolTrace) ? body.toolTrace : []);
      setWorkflowTrace(Array.isArray(body.workflowTrace) ? body.workflowTrace : []);
      setStatus(body.gated ? 'gated' : 'unlocked');
    } catch (error) {
      if (controller.signal.aborted) return;
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setStatus('error');
    }
  }, [config, canSubmit, filesBySlot, contextValue, slug]);

  // --- Unlock ------------------------------------------------------------
  const unlock = useCallback(
    async (formValues: Record<string, string>) => {
      setStatus('processing'); // reuse the spinner state for the unlock POST
      try {
        const response = await fetch(`/api/agents/${slug}/unlock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, ...formValues }),
        });
        if (!response.ok) {
          const errBody = await safeJson(response);
          throw new Error(errBody?.error ?? `Unlock failed (${response.status})`);
        }
        const data = (await response.json()) as {
          result: Record<string, unknown>;
          toolTrace?: ToolCallRecord[];
          workflowTrace?: WorkflowStepRecord[];
        };
        setDisplayedResult(data.result);
        // Unlock returns canonical traces too — prefer them over the
        // teaser-time copies in case the server ever diverges.
        if (Array.isArray(data.toolTrace)) setToolTrace(data.toolTrace);
        if (Array.isArray(data.workflowTrace)) setWorkflowTrace(data.workflowTrace);
        setStatus('unlocked');
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
        setStatus('error');
      }
    },
    [slug, sessionId],
  );

  const resetToIdle = useCallback(() => {
    setErrorMessage('');
    setFilesBySlot({});
    setDisplayedResult(null);
    setToolTrace([]);
    setWorkflowTrace([]);
    setStatus('idle');
  }, []);

  // --- Render ------------------------------------------------------------
  if (status === 'loading-config') {
    return <div className="h-64 animate-pulse rounded-2xl bg-gray-100" />;
  }

  if (!config) {
    return (
      <div className="rounded-2xl bg-red-50 p-6 text-red-800">
        Failed to load agent: {errorMessage}
      </div>
    );
  }

  return (
    <div
      className={`overflow-hidden rounded-2xl bg-white shadow-xl ${embedded ? 'h-full' : ''}`}
    >
      <header className="bg-gradient-to-r from-indigo-600 to-purple-600 p-6 text-white">
        <div className="flex items-start gap-3">
          <span className="text-3xl leading-none">{config.icon}</span>
          <div>
            <h2 className="text-xl font-bold">{config.name}</h2>
            <p className="mt-1 text-sm text-indigo-100">{config.description}</p>
          </div>
        </div>
      </header>

      <div className="p-6">
        {status === 'idle' && (
          <div className="space-y-4">
            {config.contextInput && (
              <div>
                <label
                  htmlFor={`${slug}-context`}
                  className="mb-1 block text-sm font-medium text-gray-800"
                >
                  {config.contextInput.label}
                  {config.contextInput.required && (
                    <span className="ml-1 text-red-500">*</span>
                  )}
                </label>
                <textarea
                  id={`${slug}-context`}
                  value={contextValue}
                  onChange={(e) => setContextValue(e.target.value)}
                  placeholder={config.contextInput.placeholder}
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 p-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                {config.contextInput.helpText && (
                  <p className="mt-1 text-xs text-gray-500">
                    {config.contextInput.helpText}
                  </p>
                )}
              </div>
            )}

            {config.fileSlots.map((slot) => (
              <FileSlotDropzone
                key={slot.key}
                slot={slot}
                files={filesBySlot[slot.key] ?? []}
                onChange={(files) => setSlotFiles(slot.key, files)}
              />
            ))}

            <button
              type="button"
              onClick={runAgent}
              disabled={!canSubmit}
              className="w-full rounded-lg bg-indigo-600 py-3 font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              Run agent
            </button>
          </div>
        )}

        {status === 'processing' && <ProcessingView />}

        {(status === 'gated' || status === 'unlocked') && displayedResult && (
          <ResultsView
            slug={config.slug}
            result={displayedResult}
            gated={status === 'gated'}
            remaining={remaining}
            gate={config.gate}
            onUnlock={unlock}
            toolTrace={toolTrace}
            workflowTrace={workflowTrace}
          />
        )}

        {status === 'error' && (
          <div className="space-y-4">
            <div className="rounded-xl bg-red-50 p-6 text-center">
              <p className="font-medium text-red-800">{errorMessage}</p>
              <button
                type="button"
                onClick={resetToIdle}
                className="mt-4 rounded-lg bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700"
              >
                Try again
              </button>
            </div>
            {/* Show partial trace if the failure happened mid-workflow —
                a "step 3 failed" timeline is more diagnostic than a bare
                error string. */}
            {workflowTrace.length > 0 && <WorkflowTraceView trace={workflowTrace} />}
            {toolTrace.length > 0 && <ToolTraceView trace={toolTrace} />}
          </div>
        )}
      </div>

      {!embedded && (
        <footer className="border-t bg-gray-50 px-6 py-3 text-center text-xs text-gray-400">
          Powered by your AI Agent Marketplace
        </footer>
      )}
    </div>
  );
}

/**
 * One dropzone per declared slot. We extract this into a subcomponent so
 * each instance owns its own `useDropzone` call — hooks can't live inside
 * a parent `.map()` loop.
 */
function FileSlotDropzone({
  slot,
  files,
  onChange,
}: {
  slot: FileSlot;
  files: File[];
  onChange: (files: File[]) => void;
}) {
  const accept = useMemo(
    () => Object.fromEntries(slot.extensions.map((ext) => [ext, []])),
    [slot.extensions],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (accepted) => {
      // When maxFiles is 1 we replace rather than append — feels right for
      // "drop a new file over the old one" UX.
      if (slot.maxFiles === 1) {
        onChange(accepted.slice(0, 1));
      } else {
        // Merge + dedupe by name; cap at maxFiles. Dedupe-by-name is a
        // heuristic (same name could mean a revision), but it's the
        // cheapest way to avoid accidental double-drops.
        const byName = new Map<string, File>();
        for (const f of [...files, ...accepted]) byName.set(f.name, f);
        onChange(Array.from(byName.values()).slice(0, slot.maxFiles));
      }
    },
    accept,
    maxFiles: slot.maxFiles,
    maxSize: slot.maxSizeMB * 1024 * 1024,
  });

  const required = slot.required !== false;
  const multi = slot.maxFiles > 1;

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-800">
        {slot.label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </label>
      <div
        {...getRootProps()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
          isDragActive
            ? 'border-indigo-500 bg-indigo-50'
            : files.length > 0
              ? 'border-green-400 bg-green-50'
              : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        <input {...getInputProps()} />
        {files.length === 0 ? (
          <>
            <div className="mb-2 text-3xl">📁</div>
            <p className="text-sm font-medium text-gray-700">{slot.description}</p>
            <p className="mt-1 text-xs text-gray-400">
              {slot.extensions.join(', ')} · max {slot.maxSizeMB}MB
              {multi ? ` · up to ${slot.maxFiles} files` : ''}
            </p>
          </>
        ) : (
          <div className="text-left">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-green-700">
              {files.length} file{files.length === 1 ? '' : 's'} ready
            </p>
            <ul className="space-y-1 text-sm text-gray-700">
              {files.map((f) => (
                <li key={f.name} className="flex items-center gap-2">
                  <span className="text-green-600">✓</span>
                  <span className="truncate">{f.name}</span>
                  <span className="text-xs text-gray-400">
                    ({(f.size / 1024).toFixed(0)} KB)
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-indigo-600">
              Click or drop to {multi ? 'add more' : 'replace'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Processing view — spinner + rotating status line. The agent spends most
 * of its time either in tool calls (web search, currency lookup, webpage
 * fetch) or in the structuring pass. We cycle through friendly messages
 * so the visitor sees progress even though we can't stream partials.
 *
 * Rotation is cosmetic — each message shows for ~4s regardless of what
 * the server is actually doing. The point is to convey "the agent is
 * doing real work", not to report granular status (we'd need streaming
 * for that, which hangs on some AV-heavy Windows setups).
 */
function ProcessingView() {
  const steps = useMemo(
    () => [
      'Reading your files…',
      'Researching each item on the public web…',
      'Cross-referencing with your context…',
      'Structuring the final report…',
    ],
    [],
  );
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const id = window.setInterval(
      () => setIdx((i) => Math.min(i + 1, steps.length - 1)),
      4000,
    );
    return () => window.clearInterval(id);
  }, [steps.length]);

  return (
    <div className="py-6 text-center">
      <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
      <p className="text-sm text-gray-600">{steps[idx]}</p>
      <p className="mt-1 text-xs text-gray-400">
        Agents that use live web tools usually take 20-60 seconds.
      </p>
    </div>
  );
}

/**
 * Results view — dispatches on slug to the right per-agent renderer. Agents
 * produce structurally different outputs (lead rows vs invoice rows), so a
 * single generic renderer would either be ugly or over-abstracted.
 *
 * When a new agent ships, add a `case` here and a view component below.
 * The gate form is shared across all agents.
 */
function ResultsView({
  slug,
  result,
  gated,
  remaining,
  gate,
  onUnlock,
  toolTrace,
  workflowTrace,
}: {
  slug: string;
  result: Record<string, unknown>;
  gated: boolean;
  remaining: number;
  gate: PublicAgentConfig['gate'];
  onUnlock: (values: Record<string, string>) => void;
  toolTrace: ToolCallRecord[];
  workflowTrace: WorkflowStepRecord[];
}) {
  let body: React.ReactNode;
  switch (slug) {
    case 'lead-qualifier':
      body = <LeadsView result={result} />;
      break;
    case 'invoice-auditor':
      body = <InvoicesView result={result} />;
      break;
    default:
      body = <GenericJsonView result={result} />;
  }

  return (
    <div className="space-y-4">
      {/* Workflow timeline first — it's the proof-of-Level-3 work. The
          flat tool trace is a subset of the workflow data, but kept as
          a separate component because L2 agents (no workflow) still
          surface it. For L3 agents both are shown; the timeline gives
          the narrative, the tool trace gives the raw call list. */}
      {workflowTrace.length > 0 && <WorkflowTraceView trace={workflowTrace} />}
      {toolTrace.length > 0 && workflowTrace.length === 0 && (
        <ToolTraceView trace={toolTrace} />
      )}
      {body}
      {gated && <GateForm gate={gate} remaining={remaining} onSubmit={onUnlock} />}
    </div>
  );
}

/**
 * Vertical step timeline for Level-3 (workflow) agents.
 *
 * Each step is a row with:
 *   - status icon (✓ completed, ⊘ skipped, ⚠ failed, … pending)
 *   - name + duration
 *   - one-line summary
 *   - skipped steps include the human reason ("no cross-currency invoices")
 *   - completed steps with tool calls show the tool count + an expandable
 *     per-tool detail
 *
 * This is the "we built actual workflow plumbing" signal — agents that
 * skip work transparently, with a reason, beat agents that opaquely
 * decide internally.
 */
function WorkflowTraceView({ trace }: { trace: WorkflowStepRecord[] }) {
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
                    <div
                      key={j}
                      className={`rounded border px-2 py-1 text-xs ${
                        t.failed
                          ? 'border-red-200 bg-red-50 text-red-800'
                          : 'border-indigo-100 bg-white text-gray-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-medium">{t.tool}</span>
                        {t.durationMs > 0 && (
                          <span className="text-gray-400">{t.durationMs}ms</span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-gray-500">
                        {JSON.stringify(t.args)}
                      </div>
                      <div
                        className={`mt-0.5 ${t.failed ? 'text-red-700' : 'text-indigo-700'}`}
                      >
                        → {t.summary}
                      </div>
                    </div>
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
    completed: {
      char: '✓',
      classes: 'bg-green-100 text-green-700',
      label: 'Completed',
    },
    skipped: {
      char: '⊘',
      classes: 'bg-gray-100 text-gray-500',
      label: 'Skipped',
    },
    failed: {
      char: '✕',
      classes: 'bg-red-100 text-red-700',
      label: 'Failed',
    },
    pending: {
      char: '…',
      classes: 'bg-gray-100 text-gray-400',
      label: 'Pending',
    },
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

/**
 * Shows the agent's research work: how many tool calls it made, which
 * tools, and (expanded) the actual args + summary of each call. This is
 * the visible "this isn't a prompt wrapper" signal for the visitor.
 */
function ToolTraceView({ trace }: { trace: ToolCallRecord[] }) {
  const [expanded, setExpanded] = useState(false);

  // Count by tool name for the compact summary line.
  const counts = useMemo(() => {
    const m = new Map<string, { ok: number; failed: number }>();
    for (const t of trace) {
      const entry = m.get(t.tool) ?? { ok: 0, failed: 0 };
      if (t.failed) entry.failed += 1;
      else entry.ok += 1;
      m.set(t.tool, entry);
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
              .map(([tool, { ok, failed }]) =>
                failed > 0 ? `${tool} (${ok}✓ ${failed}✗)` : `${tool} (${ok})`,
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
            <li
              key={i}
              className={`rounded border px-2 py-1.5 text-xs ${
                t.failed
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : 'border-indigo-100 bg-white text-gray-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-medium">
                  {i + 1}. {t.tool}
                </span>
                {t.durationMs > 0 && (
                  <span className="text-gray-400">{t.durationMs}ms</span>
                )}
              </div>
              <div className="mt-0.5 truncate font-mono text-gray-500">
                {JSON.stringify(t.args)}
              </div>
              <div className={`mt-0.5 ${t.failed ? 'text-red-700' : 'text-indigo-700'}`}>
                → {t.summary}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// -------------------- Lead Qualifier results --------------------

function LeadsView({ result }: { result: Record<string, unknown> }) {
  const leadsRaw = result.leads;
  const leads: Array<Record<string, unknown>> = Array.isArray(leadsRaw)
    ? (leadsRaw as Array<Record<string, unknown>>)
    : [];

  const hotCount = typeof result.hotCount === 'number' ? result.hotCount : undefined;
  const warmCount = typeof result.warmCount === 'number' ? result.warmCount : undefined;
  const totalLeads =
    typeof result.totalLeads === 'number' ? result.totalLeads : leads.length;

  return (
    <>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">
          Scored {totalLeads} lead{totalLeads === 1 ? '' : 's'}
        </h3>
        <div className="flex gap-2 text-xs font-medium">
          {hotCount !== undefined && (
            <span className="rounded bg-red-100 px-2 py-1 text-red-700">
              {hotCount} HOT
            </span>
          )}
          {warmCount !== undefined && (
            <span className="rounded bg-yellow-100 px-2 py-1 text-yellow-700">
              {warmCount} WARM
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {leads.map((lead, i) => (
          <LeadRow key={i} lead={lead} />
        ))}
      </div>
    </>
  );
}

function LeadRow({ lead }: { lead: Record<string, unknown> }) {
  const name = typeof lead.name === 'string' ? lead.name : '—';
  const email = typeof lead.email === 'string' ? lead.email : '';
  const score = typeof lead.score === 'number' ? lead.score : 0;
  const grade = typeof lead.grade === 'string' ? lead.grade : 'COLD';
  const reasoning = typeof lead.reasoning === 'string' ? lead.reasoning : '';
  const outreach =
    typeof lead.suggestedOutreach === 'string' ? lead.suggestedOutreach : '';

  const gradeClasses =
    grade === 'HOT'
      ? 'bg-red-100 text-red-700'
      : grade === 'WARM'
        ? 'bg-yellow-100 text-yellow-700'
        : 'bg-gray-100 text-gray-600';

  return (
    <div className="rounded-lg border p-3 transition-shadow hover:shadow-sm">
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

// -------------------- Invoice Auditor results --------------------

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
    <>
      <div className="space-y-3">
        <h3 className="font-semibold text-gray-800">
          Audited {total} invoice{total === 1 ? '' : 's'}
          {totalValue !== undefined && (
            <span className="ml-2 text-sm font-normal text-gray-500">
              · {formatUSD(totalValue)} total
            </span>
          )}
        </h3>

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
      </div>

      <div className="space-y-2">
        {invoices.map((inv, i) => (
          <InvoiceRow key={i} invoice={inv} />
        ))}
      </div>
    </>
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
    <div className="rounded-lg border p-3 transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-gray-800">
            {invoiceNumber}
            <span className="ml-2 text-sm font-normal text-gray-500">{vendor}</span>
          </p>
          <p className="mt-0.5 text-sm text-gray-600">
            {amount !== undefined && (
              <span className="font-medium">
                {currency === 'USD' ? formatUSD(amount) : `${currency} ${amount.toFixed(2)}`}
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

// -------------------- Shared bits --------------------

function GenericJsonView({ result }: { result: Record<string, unknown> }) {
  // Fallback for agents without a bespoke view — we show raw JSON so the
  // visitor isn't staring at an empty card while we build a proper renderer.
  return (
    <pre className="max-h-96 overflow-auto rounded bg-gray-50 p-3 text-xs text-gray-700">
      {JSON.stringify(result, null, 2)}
    </pre>
  );
}

function GateForm({
  gate,
  remaining,
  onSubmit,
}: {
  gate: PublicAgentConfig['gate'];
  remaining: number;
  onSubmit: (values: Record<string, string>) => void;
}) {
  const message = gate.message.replace('{remaining}', String(remaining));

  return (
    <div className="mt-6 rounded-xl border-t bg-indigo-50 p-6">
      <p className="mb-4 text-center font-medium text-indigo-900">🔒 {message}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          const values = Object.fromEntries(formData) as Record<string, string>;
          onSubmit(values);
        }}
        className="space-y-3"
      >
        {gate.fields.map((field) => (
          <div key={field.name}>
            {field.type === 'select' ? (
              <select
                name={field.name}
                required={field.required}
                className="w-full rounded-lg border bg-white px-4 py-2 focus:ring-2 focus:ring-indigo-500"
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
                className="w-full rounded-lg border px-4 py-2 focus:ring-2 focus:ring-indigo-500"
              />
            )}
          </div>
        ))}

        <button
          type="submit"
          className="w-full rounded-lg bg-indigo-600 py-3 font-medium text-white transition-colors hover:bg-indigo-700"
        >
          {gate.ctaText}
        </button>
      </form>
      <p className="mt-3 text-center text-xs text-gray-500">
        No spam. Unsubscribe anytime.
      </p>
    </div>
  );
}

async function safeJson(response: Response): Promise<{ error?: string } | null> {
  try {
    return (await response.json()) as { error?: string };
  } catch {
    return null;
  }
}

// Coerce helpers — the server's Zod schema gives us well-typed data, but
// the UI receives it via JSON so TS can't statically prove types. These
// keep the render code branch-free instead of `typeof x === 'number'` inline.
function numberOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function stringOr(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}
function formatEnum(s: string): string {
  // AUTO_APPROVE → Auto approve · WITHIN_TOLERANCE → Within tolerance
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
