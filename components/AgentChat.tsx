'use client';

/**
 * AgentChat — chat-style marketplace interface.
 *
 * Why a chat (not the per-agent form card):
 *   The form-and-button card felt like a spreadsheet tool. Visitors fill
 *   fields, click submit, wait, see output, leave. A chat layout matches
 *   how people already think about LLMs in 2026 — they just want to ask
 *   for something and get a reply. The friction of "first the ICP box,
 *   then the dropzone, then the run button" disappears when the agent
 *   says "send me your CSV and tell me about your ICP" and the composer
 *   accepts both at once.
 *
 * Layout:
 *
 *   ┌────────────────────────────────────────────────────┐
 *   │  Agent dropdown  ▼     "switch agents resets chat" │  ← header
 *   ├────────────────────────────────────────────────────┤
 *   │ 🤖  Hi! I'm the Lead Qualifier. Drop your lead    │
 *   │     CSV and tell me about your ICP …              │
 *   │                                                    │
 *   │                              [📎 leads.csv] you 👤 │  ← user msg
 *   │                                                    │
 *   │ 🤖  ⚙ Workflow timeline                           │
 *   │     [scored leads list]                           │
 *   │     [🔒 unlock to see remaining 12]               │
 *   ├────────────────────────────────────────────────────┤
 *   │ 📎 Lead list ▾  Type your ICP…       [Send]       │  ← composer
 *   └────────────────────────────────────────────────────┘
 *
 * Switching agents:
 *   The dropdown swaps which agent the next user message goes to. If
 *   there's already a real conversation (anything beyond the auto-greeting),
 *   we ask "start over with X?" before clearing — losing a paid analysis
 *   to a misclick is the kind of paper cut that kills retention.
 *
 * Multi-slot agents (Invoice Auditor):
 *   The composer shows one attach button per declared slot. Each button
 *   opens a file picker constrained to that slot's accepted extensions.
 *   Drag-and-drop on the composer auto-routes by extension to the first
 *   slot that accepts it. Files appear as removable chips per slot.
 */
import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  GateForm,
  ResultsBody,
  ToolTraceView,
  AgentTurnTraceView,
} from './agent-renderers';
import IcpWizard from './IcpWizard';
import { arCollectionsWizard } from '@/lib/wizard/ar-collections';
import { churnRiskWizard } from '@/lib/wizard/churn-risk';
import { buildDynamicWizard } from '@/lib/wizard/dynamic';
import { gccProspectorWizard } from '@/lib/wizard/gcc-prospector';
import { leadQualifierWizard } from '@/lib/wizard/lead-qualifier';
import { salesProposalWizard } from '@/lib/wizard/sales-proposal';
import { vendorEvaluatorWizard } from '@/lib/wizard/vendor-evaluator';
import type { Question, WizardDefinition } from '@/lib/wizard/types';
import type {
  PublicAgentConfig,
  ToolCallRecord,
  AgentTurnRecord,
} from '@/lib/agents/types';

/**
 * Per-agent decision: which slug uses which wizard. Keeping this in a
 * single map (vs. a config flag on AgentConfig) means adding a wizard
 * to a new agent is a one-line change here — no churn on the server
 * registry.
 */
const AGENT_WIZARDS: Record<string, WizardDefinition> = {
  'lead-qualifier': leadQualifierWizard,
  'gcc-prospector': gccProspectorWizard,
  'vendor-evaluator': vendorEvaluatorWizard,
  'churn-risk': churnRiskWizard,
  'sales-proposal': salesProposalWizard,
  'ar-collections': arCollectionsWizard,
};

// ---------------------------------------------------------------------------
// Message types — discriminated union
// ---------------------------------------------------------------------------

interface UserMessage {
  id: string;
  role: 'user';
  text: string;
  /** File names per slot — we don't keep the File objects after upload. */
  attachments: Array<{ slotKey: string; slotLabel: string; filenames: string[] }>;
}

interface GreetingMessage {
  id: string;
  role: 'assistant';
  kind: 'greeting';
  agentSlug: string;
}

interface ThinkingMessage {
  id: string;
  role: 'assistant';
  kind: 'thinking';
  agentSlug: string;
  startedAt: number;
}

interface ResultMessage {
  id: string;
  role: 'assistant';
  kind: 'result';
  agentSlug: string;
  result: Record<string, unknown>;
  toolTrace: ToolCallRecord[];
  turnTrace: AgentTurnRecord[];
  gated: boolean;
  remaining: number;
  sessionId: string;
  /** True after the user submits the gate form successfully — UI swaps
   *  in the full result and hides the form. */
  unlocked?: boolean;
  /** Tracks the unlock-form submission state so the form's button can
   *  show "Unlocking…" without us creating a separate message. */
  unlockBusy?: boolean;
  /** Last unlock error message, if the unlock POST failed. */
  unlockError?: string;
}

interface ErrorMessage {
  id: string;
  role: 'assistant';
  kind: 'error';
  text: string;
  /** Partial traces returned by the route on failure — useful for showing
   *  "step 3 failed: …" rather than a bare error line. */
  turnTrace?: AgentTurnRecord[];
  toolTrace?: ToolCallRecord[];
}

type Message = UserMessage | GreetingMessage | ThinkingMessage | ResultMessage | ErrorMessage;

/**
 * Next.js `basePath` does NOT auto-prefix raw `fetch()` calls — only Link,
 * Image, and router.push. We expose the value as a NEXT_PUBLIC env at build
 * time (see next.config.mjs) and prepend it manually below. Empty string
 * fallback keeps local dev working when running without a basePath.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

// ---------------------------------------------------------------------------
// Top-level component
// ---------------------------------------------------------------------------

export interface AgentChatProps {
  agents: PublicAgentConfig[];
  /** Optional initial agent (e.g., from URL `/agents/[slug]`). */
  initialAgentSlug?: string;
  /**
   * When true, the agent-switcher dropdown is hidden and the header
   * shows a "Back to marketplace" link instead. Use this on the
   * `/agents/[slug]` page where the URL already specifies which
   * agent is in focus.
   */
  lockedToAgent?: boolean;
}

export default function AgentChat({ agents, initialAgentSlug, lockedToAgent }: AgentChatProps) {
  // The agent the dropdown currently points at — drives the greeting and
  // composer slots. Defaults to the URL slug if valid, else the first agent.
  const [selectedSlug, setSelectedSlug] = useState<string>(() => {
    if (initialAgentSlug && agents.some((a) => a.slug === initialAgentSlug)) {
      return initialAgentSlug;
    }
    return agents[0]?.slug ?? '';
  });

  const selectedAgent = useMemo(
    () => agents.find((a) => a.slug === selectedSlug),
    [agents, selectedSlug],
  );

  // Composer state — staged files per slot key + the text body.
  const [composerText, setComposerText] = useState('');
  const [composerFiles, setComposerFiles] = useState<Record<string, File[]>>({});

  // Wizard state — when the visitor lands on an agent that has a
  // registered wizard, it runs in place of the composer until completion.
  // After completion, `wizardIcp` holds the structured ICP block and the
  // composer becomes available (pre-filled).
  const [wizardIcp, setWizardIcp] = useState<string | null>(null);
  const [wizardSkipped, setWizardSkipped] = useState(false);

  // Dynamic-wizard state — for agents with `dynamicWizard` config
  // (e.g., Resume Screener). The visitor uploads ONE trigger file
  // first; the server analyzes it and returns a custom wizard, which
  // we then render via the same IcpWizard component as the preset
  // wizards.
  const [dynamicWizard, setDynamicWizard] = useState<WizardDefinition | null>(null);
  const [dynamicWizardBuilding, setDynamicWizardBuilding] = useState(false);
  const [dynamicWizardError, setDynamicWizardError] = useState<string | null>(null);

  const isDynamicWizardAgent = !!selectedAgent?.dynamicWizard;
  const triggerSlot = selectedAgent?.dynamicWizard?.triggerSlot ?? null;
  const triggerSlotHasFile =
    triggerSlot != null && (composerFiles[triggerSlot]?.length ?? 0) > 0;

  // For dynamic-wizard agents, the "wizard to render" is whichever
  // the server returned (or null if not built yet). For preset agents,
  // it's the static one looked up from AGENT_WIZARDS.
  const activeWizard: WizardDefinition | undefined = isDynamicWizardAgent
    ? (dynamicWizard ?? undefined)
    : selectedAgent
      ? AGENT_WIZARDS[selectedAgent.slug]
      : undefined;

  const showWizard = !!activeWizard && wizardIcp === null && !wizardSkipped;

  // "Pre-build" stage for dynamic-wizard agents: the visitor hasn't
  // uploaded the trigger file yet (or has uploaded but not built
  // the wizard). In this stage we suppress the regular Composer and
  // show a focused upload panel inline in the chat.
  const showDynamicTriggerStage =
    isDynamicWizardAgent && !activeWizard && !wizardIcp;

  // Conversation transcript. Grows append-only; we never edit prior
  // messages except to mutate the gate state on a Result message in-place.
  const [messages, setMessages] = useState<Message[]>([]);

  // Track in-flight processing so we disable the composer + dropdown while
  // the agent is running. Also gives us an obvious "abort" target later.
  const abortRef = useRef<AbortController | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // ----- Agent switching --------------------------------------------------
  // When the dropdown changes, reset the conversation immediately. We used
  // to gate this on a `confirm()` popup when the chat had user messages,
  // but that turned out to be the wrong UX: visitors often try a tool by
  // accident (or hit an error) and want to switch without acknowledging a
  // popup. The chat content is cheap to regenerate, so just swap silently.
  const handleAgentChange = useCallback(
    (newSlug: string) => {
      if (newSlug === selectedSlug) return;
      setSelectedSlug(newSlug);
    },
    [selectedSlug],
  );

  // Whenever the selected agent changes, reset the conversation and stage.
  // Done in an effect so it also fires for the initial mount, giving us a
  // clean greeting without a special-case in render.
  useEffect(() => {
    if (!selectedAgent) {
      setMessages([]);
      return;
    }
    setMessages([
      {
        id: makeId(),
        role: 'assistant',
        kind: 'greeting',
        agentSlug: selectedAgent.slug,
      },
    ]);
    setComposerText('');
    setComposerFiles({});
    setWizardIcp(null);
    setWizardSkipped(false);
    setDynamicWizard(null);
    setDynamicWizardBuilding(false);
    setDynamicWizardError(null);
    abortRef.current?.abort();
    abortRef.current = null;
    setIsProcessing(false);
  }, [selectedAgent?.slug]);

  // ----- Auto-scroll to newest message ------------------------------------
  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // smooth on appended messages, instant on agent swap (single greeting)
    el.scrollTo({ top: el.scrollHeight, behavior: messages.length > 1 ? 'smooth' : 'auto' });
  }, [messages]);

  // ----- File staging helpers ---------------------------------------------
  const addFilesToSlot = useCallback((slotKey: string, files: File[]) => {
    setComposerFiles((prev) => {
      const existing = prev[slotKey] ?? [];
      // Dedupe by name and respect the slot's maxFiles. We don't know the
      // slot here without lookup, so the caller already validated.
      const byName = new Map<string, File>();
      for (const f of [...existing, ...files]) byName.set(f.name, f);
      return { ...prev, [slotKey]: Array.from(byName.values()) };
    });
  }, []);

  const removeFile = useCallback((slotKey: string, filename: string) => {
    setComposerFiles((prev) => ({
      ...prev,
      [slotKey]: (prev[slotKey] ?? []).filter((f) => f.name !== filename),
    }));
  }, []);

  // Drop on the composer — auto-route by extension to the first slot that
  // accepts it. Visitor doesn't have to remember which button to click.
  const onComposerDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (!selectedAgent || isProcessing) return;
      const dropped = Array.from(e.dataTransfer.files);
      if (dropped.length === 0) return;

      // Group files by which slot they belong to. If a file matches no
      // slot, drop it silently (could surface a toast later).
      const grouped = new Map<string, File[]>();
      for (const file of dropped) {
        const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase();
        const slot = selectedAgent.fileSlots.find((s) => s.extensions.includes(ext));
        if (!slot) continue;
        const arr = grouped.get(slot.key) ?? [];
        arr.push(file);
        grouped.set(slot.key, arr);
      }
      for (const [slotKey, files] of grouped.entries()) {
        const slot = selectedAgent.fileSlots.find((s) => s.key === slotKey);
        if (!slot) continue;
        const capped = slot.maxFiles === 1 ? files.slice(0, 1) : files.slice(0, slot.maxFiles);
        addFilesToSlot(slotKey, capped);
      }
    },
    [selectedAgent, isProcessing, addFilesToSlot],
  );

  // ----- Build dynamic wizard from the trigger file -----------------------
  const buildDynamicWizardFromFile = useCallback(async () => {
    if (!selectedAgent || !triggerSlot || isProcessing || dynamicWizardBuilding) return;
    const triggerFile = composerFiles[triggerSlot]?.[0];
    if (!triggerFile) return;

    setDynamicWizardBuilding(true);
    setDynamicWizardError(null);

    const formData = new FormData();
    formData.append(triggerSlot, triggerFile);

    try {
      const response = await fetch(
        `${BASE_PATH}/api/agents/${selectedAgent.slug}/build-wizard`,
        { method: 'POST', body: formData },
      );
      const body = (await safeJson(response)) as
        | { wizard?: { title?: string; questions: Question[] }; error?: string }
        | null;
      if (!response.ok || !body?.wizard) {
        throw new Error(body?.error ?? `Wizard build failed (${response.status})`);
      }
      setDynamicWizard(
        buildDynamicWizard(
          { title: body.wizard.title, questions: body.wizard.questions },
          'Screening criteria',
        ),
      );
    } catch (error) {
      setDynamicWizardError(error instanceof Error ? error.message : String(error));
    } finally {
      setDynamicWizardBuilding(false);
    }
  }, [
    selectedAgent,
    triggerSlot,
    composerFiles,
    isProcessing,
    dynamicWizardBuilding,
  ]);

  // ----- Send → POST /process ---------------------------------------------
  const send = useCallback(async () => {
    if (!selectedAgent || isProcessing) return;

    // Validate required slots up front — friendlier than letting the
    // server reject the multipart and surfacing a generic error.
    for (const slot of selectedAgent.fileSlots) {
      const required = slot.required !== false;
      const count = composerFiles[slot.key]?.length ?? 0;
      if (required && count === 0) {
        appendMessage({
          id: makeId(),
          role: 'assistant',
          kind: 'error',
          text: `${selectedAgent.name} needs at least one file in "${slot.label}".`,
        });
        return;
      }
    }
    if (selectedAgent.contextInput?.required && !composerText.trim()) {
      appendMessage({
        id: makeId(),
        role: 'assistant',
        kind: 'error',
        text: `${selectedAgent.name} needs ${selectedAgent.contextInput.label.toLowerCase()}.`,
      });
      return;
    }

    // Snapshot the composer into a user message + clear for next turn.
    const attachments = selectedAgent.fileSlots
      .filter((s) => (composerFiles[s.key]?.length ?? 0) > 0)
      .map((s) => ({
        slotKey: s.key,
        slotLabel: s.label,
        filenames: (composerFiles[s.key] ?? []).map((f) => f.name),
      }));

    const userMsg: UserMessage = {
      id: makeId(),
      role: 'user',
      text: composerText.trim(),
      attachments,
    };
    const thinkingMsg: ThinkingMessage = {
      id: makeId(),
      role: 'assistant',
      kind: 'thinking',
      agentSlug: selectedAgent.slug,
      startedAt: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg, thinkingMsg]);

    // Build the multipart body BEFORE clearing state so we capture the
    // File handles. Then clear the composer so the user sees their
    // submission as "sent".
    const formData = new FormData();
    for (const slot of selectedAgent.fileSlots) {
      for (const file of composerFiles[slot.key] ?? []) {
        formData.append(slot.key, file);
      }
    }
    formData.append('context', composerText);

    setComposerText('');
    setComposerFiles({});
    setIsProcessing(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`${BASE_PATH}/api/agents/${selectedAgent.slug}/process`, {
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
            turnTrace?: AgentTurnRecord[];
            error?: string;
          }
        | null;

      if (!response.ok) {
        replaceMessage(thinkingMsg.id, {
          id: thinkingMsg.id,
          role: 'assistant',
          kind: 'error',
          text: body?.error ?? `Processing failed (${response.status})`,
          turnTrace: body?.turnTrace,
          toolTrace: body?.toolTrace,
        });
        return;
      }
      if (!body || !body.teaser) {
        replaceMessage(thinkingMsg.id, {
          id: thinkingMsg.id,
          role: 'assistant',
          kind: 'error',
          text: 'Agent returned no result. Check the dev-server logs.',
        });
        return;
      }

      replaceMessage(thinkingMsg.id, {
        id: thinkingMsg.id,
        role: 'assistant',
        kind: 'result',
        agentSlug: selectedAgent.slug,
        result: body.teaser,
        toolTrace: body.toolTrace ?? [],
        turnTrace: body.turnTrace ?? [],
        gated: Boolean(body.gated),
        remaining: body.remaining ?? 0,
        sessionId: body.sessionId ?? '',
      });
    } catch (error) {
      if (controller.signal.aborted) {
        // Aborted by an agent switch — drop the thinking placeholder so
        // the new conversation starts clean.
        removeMessage(thinkingMsg.id);
        return;
      }
      replaceMessage(thinkingMsg.id, {
        id: thinkingMsg.id,
        role: 'assistant',
        kind: 'error',
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsProcessing(false);
      abortRef.current = null;
    }
  }, [selectedAgent, composerFiles, composerText, isProcessing]);

  // ----- Unlock handler (per-message, since each result has its own gate) -
  const unlockMessage = useCallback(
    async (msgId: string, values: Record<string, string>) => {
      // Look up the message + its agent once, then mark it busy so the
      // form button can show "Unlocking…".
      let msg: ResultMessage | undefined;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msgId || m.role !== 'assistant' || m.kind !== 'result') return m;
          msg = m;
          return { ...m, unlockBusy: true, unlockError: undefined };
        }),
      );
      if (!msg) return;
      const slug = msg.agentSlug;
      const sessionId = msg.sessionId;

      try {
        const response = await fetch(`${BASE_PATH}/api/agents/${slug}/unlock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, ...values }),
        });
        if (!response.ok) {
          const errBody = await safeJson(response);
          throw new Error(errBody?.error ?? `Unlock failed (${response.status})`);
        }
        const data = (await response.json()) as {
          result: Record<string, unknown>;
          toolTrace?: ToolCallRecord[];
          turnTrace?: AgentTurnRecord[];
        };
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId && m.role === 'assistant' && m.kind === 'result'
              ? {
                  ...m,
                  result: data.result,
                  toolTrace: Array.isArray(data.toolTrace) ? data.toolTrace : m.toolTrace,
                  turnTrace: Array.isArray(data.turnTrace)
                    ? data.turnTrace
                    : m.turnTrace,
                  unlocked: true,
                  unlockBusy: false,
                }
              : m,
          ),
        );
      } catch (error) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId && m.role === 'assistant' && m.kind === 'result'
              ? {
                  ...m,
                  unlockBusy: false,
                  unlockError: error instanceof Error ? error.message : String(error),
                }
              : m,
          ),
        );
      }
    },
    [],
  );

  // ----- Message-list mutation helpers ------------------------------------
  function appendMessage(m: Message) {
    setMessages((prev) => [...prev, m]);
  }
  function replaceMessage(id: string, m: Message) {
    setMessages((prev) => prev.map((x) => (x.id === id ? m : x)));
  }
  function removeMessage(id: string) {
    setMessages((prev) => prev.filter((x) => x.id !== id));
  }

  // ----- Composer enable rules --------------------------------------------
  const canSend = useMemo(() => {
    if (!selectedAgent || isProcessing) return false;
    for (const slot of selectedAgent.fileSlots) {
      const required = slot.required !== false;
      if (required && (composerFiles[slot.key]?.length ?? 0) === 0) return false;
    }
    if (selectedAgent.contextInput?.required && !composerText.trim()) return false;
    return true;
  }, [selectedAgent, isProcessing, composerFiles, composerText]);

  // ----- Render -----------------------------------------------------------
  if (!selectedAgent) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        No agents available.
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <BrandBar />
      <Header
        agents={agents}
        selected={selectedAgent}
        onSelect={handleAgentChange}
        disabled={isProcessing}
        lockedToAgent={!!lockedToAgent}
      />

      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto"
        onDragOver={(e) => e.preventDefault()}
        onDrop={showWizard || showDynamicTriggerStage ? undefined : onComposerDrop}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
          {messages.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              agent={resolveAgentForMessage(m, agents) ?? selectedAgent}
              onUnlock={(values) => unlockMessage(m.id, values)}
            />
          ))}

          {/* Stage A/B/C — dynamic-wizard agents pre-wizard-build */}
          {showDynamicTriggerStage && triggerSlot && (
            <DynamicWizardTrigger
              agent={selectedAgent}
              triggerSlotKey={triggerSlot}
              files={composerFiles}
              onAddFiles={(files) => addFilesToSlot(triggerSlot, files)}
              onRemoveFile={(filename) => removeFile(triggerSlot, filename)}
              onBuildWizard={buildDynamicWizardFromFile}
              building={dynamicWizardBuilding}
              error={dynamicWizardError}
              triggerHasFile={triggerSlotHasFile}
            />
          )}

          {/* Stage D — wizard rendering (preset or dynamic) */}
          {showWizard && activeWizard && (
            <IcpWizard
              wizard={activeWizard}
              onComplete={(icpText) => {
                setWizardIcp(icpText);
                setComposerText(icpText);
              }}
              // For dynamic-wizard agents we don't offer a "type
              // freely instead" escape — the whole point is the
              // questions came from the file.
              onSkipWizard={
                isDynamicWizardAgent ? undefined : () => setWizardSkipped(true)
              }
            />
          )}
        </div>
      </div>

      {/* Composer hidden until the wizard (if any) is past. For
          dynamic-wizard agents, also hidden in the pre-build stages —
          DynamicWizardTrigger handles the upload UI there. */}
      {!showWizard && !showDynamicTriggerStage && (
        <Composer
          agent={selectedAgent}
          text={composerText}
          files={composerFiles}
          canSend={canSend}
          isProcessing={isProcessing}
          onTextChange={setComposerText}
          onAddFiles={addFilesToSlot}
          onRemoveFile={removeFile}
          onSend={send}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Brand bar — Beanbag AI logo + name on a dark band
// ---------------------------------------------------------------------------

/**
 * Top-of-page brand strip. Sits above the agent dropdown so visitors
 * land on a "Beanbag AI" page first, not a generic agent picker.
 *
 * Dark background by design: the live Beanbag logo is an orange-to-red
 * bean shape, which pops on near-black but disappears on white. Text is
 * white for the same reason — high contrast against the dark band.
 *
 * The logo file is bundled in /public and served from `${BASE_PATH}/...`
 * because Next.js's `basePath` setting does NOT auto-prefix `<img src>`
 * the way it does for `<Link>` / `next/image`. Explicit prefix is safer
 * than discovering the asset 404'd in production.
 */
function BrandBar() {
  return (
    <div className="border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-3.5">
        {/* Logo + wordmark — clickable cluster routes back to the
            marketplace grid. Matches the brand bar on the landing
            page so visitors learn one navigation pattern. */}
        <a
          href={`${BASE_PATH}/`}
          className="group flex items-center gap-2.5 outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
          aria-label="Back to marketplace"
        >
          {/*  eslint-disable-next-line @next/next/no-img-element  */}
          <img
            src={`${BASE_PATH}/beanbag-logo.png`}
            alt="Beanbag AI"
            className="h-7 w-7 shrink-0 object-contain transition-transform group-hover:scale-105"
          />
          <span className="text-sm font-semibold tracking-tight text-foreground transition-colors group-hover:text-brand-600">
            Beanbag AI
          </span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            · Agent marketplace
          </span>
        </a>
        <a
          href="https://www.beanbag.ai"
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-foreground/85 transition-colors hover:text-brand-600"
        >
          beanbag.ai ↗
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header — title + agent dropdown
// ---------------------------------------------------------------------------

function Header({
  agents,
  selected,
  onSelect,
  disabled,
  lockedToAgent,
}: {
  agents: PublicAgentConfig[];
  selected: PublicAgentConfig;
  onSelect: (slug: string) => void;
  disabled: boolean;
  lockedToAgent: boolean;
}) {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-4">
        <div className="flex min-w-0 items-center gap-3.5">
          {/* Icon tile — matches the marketplace card treatment so
              visitors see continuity from the grid into the agent. */}
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 text-xl ring-1 ring-inset ring-brand-200/60">
            {selected.icon}
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-serif text-lg font-semibold leading-tight text-foreground">
              {selected.name}
            </h1>
            <p className="truncate text-xs leading-snug text-muted-foreground">
              {selected.description}
            </p>
          </div>
        </div>
        {lockedToAgent ? (
          <a
            href={`${BASE_PATH}/`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground/85 transition-all hover:border-brand-300 hover:text-brand-600 hover:shadow-sm"
          >
            <span aria-hidden>←</span>
            <span>All agents</span>
          </a>
        ) : (
          <label className="flex shrink-0 items-center gap-2 text-sm">
            <span className="hidden text-muted-foreground sm:inline">Agent:</span>
            <select
              value={selected.slug}
              onChange={(e) => onSelect(e.target.value)}
              disabled={disabled}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {agents.map((a) => (
                <option key={a.slug} value={a.slug}>
                  {a.icon} {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// One row in the transcript — dispatches to per-kind renderer
// ---------------------------------------------------------------------------

function MessageRow({
  message,
  agent,
  onUnlock,
}: {
  message: Message;
  agent: PublicAgentConfig;
  onUnlock: (values: Record<string, string>) => void;
}) {
  if (message.role === 'user') {
    return <UserMessageView message={message} />;
  }

  // Assistant variants share the same chrome (avatar + bubble).
  return (
    <div className="flex items-start gap-3">
      <Avatar emoji={agent.icon} />
      <div className="min-w-0 flex-1 space-y-3">
        {message.kind === 'greeting' && <GreetingView agent={agent} />}
        {message.kind === 'thinking' && <ThinkingView startedAt={message.startedAt} />}
        {message.kind === 'result' && (
          <ResultView message={message} agent={agent} onUnlock={onUnlock} />
        )}
        {message.kind === 'error' && <ErrorView message={message} />}
      </div>
    </div>
  );
}

function Avatar({ emoji }: { emoji: string }) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-base text-white shadow-brand-cta ring-2 ring-white">
      {emoji}
    </div>
  );
}

function UserMessageView({ message }: { message: UserMessage }) {
  return (
    <div className="flex items-start justify-end gap-3">
      <div className="max-w-[85%] space-y-1.5">
        {message.attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1">
            {message.attachments.flatMap((a) =>
              a.filenames.map((name) => (
                <span
                  key={`${a.slotKey}-${name}`}
                  className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2.5 py-1 text-xs font-medium text-brand-700"
                  title={`${a.slotLabel}: ${name}`}
                >
                  <span className="text-brand-500">📎</span>
                  <span className="max-w-[200px] truncate">{name}</span>
                </span>
              )),
            )}
          </div>
        )}
        {message.text && (
          <div className="rounded-2xl rounded-tr-md bg-brand-gradient px-4 py-2.5 text-sm leading-relaxed text-white shadow-brand-cta">
            {message.text}
          </div>
        )}
      </div>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground/85 ring-2 ring-white">
        you
      </div>
    </div>
  );
}

function GreetingView({ agent }: { agent: PublicAgentConfig }) {
  // Auto-derived from config — keeps each agent's tone consistent
  // across the marketplace without per-agent hand-written copy.
  const slotsList = agent.fileSlots.map((s) => s.label.toLowerCase());
  const slotsClause =
    slotsList.length === 0
      ? ''
      : slotsList.length === 1
        ? `your ${slotsList[0]}`
        : slotsList.length === 2
          ? `your ${slotsList[0]} and your ${slotsList[1]}`
          : slotsList.slice(0, -1).join(', ') +
            ', and ' +
            slotsList[slotsList.length - 1];
  const ctx = agent.contextInput?.label.toLowerCase();
  const isDynamicWizard = !!agent.dynamicWizard;

  let actionLine: string;
  if (isDynamicWizard && slotsList.length > 0) {
    const triggerSlotLabel =
      agent.fileSlots
        .find((s) => s.key === agent.dynamicWizard?.triggerSlot)
        ?.label.toLowerCase() ?? slotsList[0];
    actionLine = `Drop the ${triggerSlotLabel} below — I'll read it and build the screening questions tailored to it.`;
  } else if (ctx && slotsList.length > 0) {
    actionLine = agent.contextInput?.required
      ? `Walk through the short wizard, then attach ${slotsClause}.`
      : `Attach ${slotsClause} (and add ${ctx} if you have it for sharper results).`;
  } else if (ctx) {
    actionLine = 'Walk through the short wizard to set things up.';
  } else if (slotsList.length > 0) {
    actionLine = `Attach ${slotsClause} and hit Send.`;
  } else {
    actionLine = 'Hit Send to begin.';
  }

  return (
    <div className="rounded-2xl rounded-tl-md border border-border/60 bg-card px-5 py-4 shadow-brand-card">
      <p className="text-sm leading-relaxed text-foreground">
        Hi — I&apos;m the{' '}
        <strong className="font-semibold">{agent.name}</strong>. {agent.description}
      </p>
      <p className="mt-2.5 text-sm leading-relaxed text-foreground/85">{actionLine}</p>
    </div>
  );
}

function ThinkingView({ startedAt }: { startedAt: number }) {
  // Cycle through friendly status lines while the request is in flight.
  // We rotate slower than the actual phase boundaries because we don't
  // have streaming progress — the stages are theatre that matches the
  // *typical* lifecycle.
  const stages = useMemo(
    () => [
      'Reading your inputs…',
      'Searching the open web…',
      'Probing careers pages…',
      'Cross-referencing signals…',
      'Verifying every lead…',
      'Structuring the final report…',
    ],
    [],
  );
  const [idx, setIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    // Cycle every 12s instead of 4s — long-running discovery agents
    // would otherwise blow through all stages in 16s and then sit on
    // "Structuring…" for the remaining 5 minutes.
    const stage = window.setInterval(
      () => setIdx((i) => Math.min(i + 1, stages.length - 1)),
      12_000,
    );
    const tick = window.setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => {
      window.clearInterval(stage);
      window.clearInterval(tick);
    };
  }, [stages.length, startedAt]);

  const elapsedSec = Math.round(elapsed / 1000);
  // After the 90-second mark we surface a subtle "discovery agents take
  // a few minutes" hint so the visitor doesn't bail thinking it's hung.
  const showLongRunningHint = elapsedSec > 90;

  return (
    <div className="flex flex-col gap-1 rounded-2xl rounded-tl-md border border-border/60 bg-card px-5 py-4 text-sm text-foreground/85 shadow-brand-card">
      <div className="flex items-center gap-3">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
        <span>{stages[idx]}</span>
        <span className="ml-auto text-xs text-muted-foreground/60">{elapsedSec}s</span>
      </div>
      {showLongRunningHint && (
        <p className="ml-7 text-xs text-muted-foreground">
          Discovery agents can take 3-8 minutes when verifying many
          prospects. Hang tight — we&apos;ll show the result here when
          ready.
        </p>
      )}
    </div>
  );
}

function ResultView({
  message,
  agent,
  onUnlock,
}: {
  message: ResultMessage;
  agent: PublicAgentConfig;
  onUnlock: (values: Record<string, string>) => void;
}) {
  const showGate = message.gated && !message.unlocked;

  return (
    <div className="space-y-4 rounded-2xl rounded-tl-md border border-border/60 bg-card px-5 py-4 shadow-brand-card">
      {message.turnTrace.length > 0 && (
        <AgentTurnTraceView trace={message.turnTrace} />
      )}
      {message.toolTrace.length > 0 && message.turnTrace.length === 0 && (
        <ToolTraceView trace={message.toolTrace} />
      )}
      <ResultsBody slug={agent.slug} result={message.result} />
      {showGate && (
        <GateForm
          gate={agent.gate}
          remaining={message.remaining}
          onSubmit={onUnlock}
          busy={message.unlockBusy}
        />
      )}
      {message.unlockError && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
          Unlock failed: {message.unlockError}
        </div>
      )}
      {message.unlocked && (
        <div className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">
          ✓ Full report unlocked.
        </div>
      )}
    </div>
  );
}

function ErrorView({ message }: { message: ErrorMessage }) {
  return (
    <div className="space-y-2">
      <div className="rounded-2xl rounded-tl-sm bg-red-50 px-4 py-3 text-sm text-red-800 shadow-sm">
        ⚠ {message.text}
      </div>
      {message.turnTrace && message.turnTrace.length > 0 && (
        <AgentTurnTraceView trace={message.turnTrace} />
      )}
      {message.toolTrace && message.toolTrace.length > 0 && (
        <ToolTraceView trace={message.toolTrace} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composer — text + per-slot file attachments + send
// ---------------------------------------------------------------------------

function Composer({
  agent,
  text,
  files,
  canSend,
  isProcessing,
  onTextChange,
  onAddFiles,
  onRemoveFile,
  onSend,
}: {
  agent: PublicAgentConfig;
  text: string;
  files: Record<string, File[]>;
  canSend: boolean;
  isProcessing: boolean;
  onTextChange: (v: string) => void;
  onAddFiles: (slotKey: string, files: File[]) => void;
  onRemoveFile: (slotKey: string, filename: string) => void;
  onSend: () => void;
}) {
  const placeholder =
    agent.contextInput?.placeholder ??
    (agent.contextInput
      ? agent.contextInput.label
      : 'Add any extra context (optional) and hit Send…');

  // Enter sends; Shift+Enter inserts a newline. Standard chat shortcut.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };

  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 py-3">
        {/* Per-slot file chips. We render one chip strip per slot so the
            visitor knows which file is going into which slot. */}
        {agent.fileSlots.some((s) => (files[s.key]?.length ?? 0) > 0) && (
          <div className="flex flex-wrap gap-2">
            {agent.fileSlots.map((slot) => {
              const slotFiles = files[slot.key] ?? [];
              if (slotFiles.length === 0) return null;
              return (
                <div
                  key={slot.key}
                  className="flex flex-wrap items-center gap-1 rounded-lg bg-brand-50 px-2 py-1"
                >
                  <span className="text-xs font-medium text-brand-600">
                    {slot.label}:
                  </span>
                  {slotFiles.map((f) => (
                    <span
                      key={f.name}
                      className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-0.5 text-xs text-foreground/85"
                    >
                      📎 {f.name}
                      <button
                        type="button"
                        onClick={() => onRemoveFile(slot.key, f.name)}
                        disabled={isProcessing}
                        className="text-muted-foreground/60 hover:text-red-500 disabled:opacity-50"
                        aria-label={`Remove ${f.name}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-end gap-2">
          {/* One attach button per declared slot. With multi-slot agents the
              visitor sees explicit "Attach Invoices" + "Attach POs" buttons
              which is clearer than a single generic file picker that has
              to disambiguate after the fact. */}
          <div className="flex shrink-0 flex-col gap-1">
            {agent.fileSlots.map((slot) => (
              <SlotAttachButton
                key={slot.key}
                slot={slot}
                disabled={isProcessing}
                onFilesPicked={(picked) => onAddFiles(slot.key, picked)}
              />
            ))}
          </div>

          <textarea
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={isProcessing}
            placeholder={placeholder}
            rows={2}
            className="min-h-[44px] flex-1 resize-none rounded-xl border border-border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-background"
          />

          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            className="h-[44px] shrink-0 rounded-xl bg-brand-gradient px-5 text-sm font-semibold text-white shadow-brand-cta transition-all hover:-translate-y-0.5 hover:shadow-brand-cta-hover active:translate-y-0 disabled:cursor-not-allowed disabled:bg-none disabled:bg-ink-300 disabled:shadow-none disabled:hover:translate-y-0"
          >
            Send
          </button>
        </div>

        <p className="text-center text-[11px] text-muted-foreground/60">
          Drop files anywhere · Enter to send · Shift+Enter for newline
        </p>
      </div>
    </footer>
  );
}

function SlotAttachButton({
  slot,
  disabled,
  onFilesPicked,
}: {
  slot: PublicAgentConfig['fileSlots'][number];
  disabled: boolean;
  onFilesPicked: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length > 0) onFilesPicked(picked.slice(0, slot.maxFiles));
    // Reset so the same file can be re-picked after removal.
    e.target.value = '';
  };

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        title={`Accepted: ${slot.extensions.join(', ')} · max ${slot.maxSizeMB}MB`}
        className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground/85 hover:border-brand-400 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        📎 {slot.label}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple={slot.maxFiles > 1}
        accept={slot.extensions.join(',')}
        onChange={onChange}
        className="hidden"
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// DynamicWizardTrigger — pre-wizard upload UI for dynamic-wizard agents
// ---------------------------------------------------------------------------

/**
 * Three-state inline panel for dynamic-wizard agents (Resume Screener
 * today). Renders inside the chat thread, NOT in the composer.
 *
 *   State 1 — no file:      Dropzone for the trigger slot.
 *   State 2 — file attached: "Generate criteria from this JD" CTA.
 *   State 3 — building:     Spinner with reassuring text.
 *
 * Errors from the build-wizard endpoint surface as a small red
 * banner below the CTA. The visitor can re-upload to retry.
 */
function DynamicWizardTrigger({
  agent,
  triggerSlotKey,
  files,
  onAddFiles,
  onRemoveFile,
  onBuildWizard,
  building,
  error,
  triggerHasFile,
}: {
  agent: PublicAgentConfig;
  triggerSlotKey: string;
  files: Record<string, File[]>;
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (filename: string) => void;
  onBuildWizard: () => void;
  building: boolean;
  error: string | null;
  triggerHasFile: boolean;
}) {
  const slot = agent.fileSlots.find((s) => s.key === triggerSlotKey);
  if (!slot) return null;

  return (
    <div className="space-y-3 rounded-2xl border border-brand-100 bg-card p-5 shadow-brand-card">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-brand-700">
          Step 1 of 3
        </p>
        <h3 className="mt-1 font-serif text-lg font-semibold text-foreground">
          Upload the {slot.label.toLowerCase()} first
        </h3>
        <p className="mt-1 text-sm text-foreground/85">
          We&apos;ll read it and build a short set of screening questions
          tailored to this specific role. No preset MCQs — every option
          comes from the {slot.label.toLowerCase()} itself.
        </p>
      </div>

      <TriggerFilePicker
        slot={slot}
        files={files[triggerSlotKey] ?? []}
        onAddFiles={onAddFiles}
        onRemoveFile={onRemoveFile}
        disabled={building}
      />

      {building && (
        <div className="flex items-center gap-3 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-brand-700">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          <span>
            Reading the {slot.label.toLowerCase()} and building screening
            criteria… (10-30 seconds)
          </span>
        </div>
      )}

      {error && !building && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          ⚠ {error}
        </div>
      )}

      <button
        type="button"
        onClick={onBuildWizard}
        disabled={!triggerHasFile || building}
        className="w-full rounded-xl bg-brand-gradient py-2.5 text-sm font-medium text-white shadow-brand-cta transition-shadow hover:shadow-brand-cta-hover disabled:cursor-not-allowed disabled:bg-none disabled:bg-ink-300 disabled:shadow-none"
      >
        {building
          ? 'Building criteria…'
          : triggerHasFile
            ? `Generate criteria from this ${slot.label.toLowerCase()} →`
            : `Attach the ${slot.label.toLowerCase()} to continue`}
      </button>
    </div>
  );
}

/**
 * Click-or-drop single-file picker for the dynamic-wizard trigger slot.
 * Lighter-weight than the Composer's SlotAttachButton because it's its
 * own large UI surface — visitors should know exactly where to drop
 * the JD without hunting for an attach button.
 */
function TriggerFilePicker({
  slot,
  files,
  onAddFiles,
  onRemoveFile,
  disabled,
}: {
  slot: PublicAgentConfig['fileSlots'][number];
  files: File[];
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (filename: string) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = (picked: File[]) => {
    if (picked.length === 0) return;
    // Single-file slot — replace if a file is already present.
    if (files.length > 0) {
      files.forEach((f) => onRemoveFile(f.name));
    }
    onAddFiles(picked.slice(0, slot.maxFiles));
  };

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={0}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (disabled) return;
          const dropped = Array.from(e.dataTransfer.files);
          const ok = dropped.filter((f) => {
            const ext = '.' + (f.name.split('.').pop() ?? '').toLowerCase();
            return slot.extensions.includes(ext);
          });
          handleFiles(ok);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
          disabled
            ? 'cursor-not-allowed border-border bg-background opacity-60'
            : dragOver
              ? 'border-brand-500 bg-brand-50'
              : files.length > 0
                ? 'border-brand-200 bg-brand-50/30'
                : 'border-border bg-background hover:border-brand-300'
        }`}
      >
        {files.length > 0 ? (
          <div className="flex w-full items-center justify-between gap-3 text-sm">
            <span className="truncate text-foreground">📄 {files[0].name}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveFile(files[0].name);
              }}
              disabled={disabled}
              className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Remove file"
            >
              Replace ×
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium text-foreground">
              Drop a file here or click to browse
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {slot.extensions.join(' · ')} · up to {slot.maxSizeMB}MB
            </p>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={slot.extensions.join(',')}
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          handleFiles(picked);
          e.target.value = '';
        }}
        className="hidden"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve which agent config a given message belongs to. For greeting,
 * thinking, and result messages we stored the slug at creation time so
 * results from a previously-selected agent still render with that
 * agent's icon and gate copy after the dropdown changes mid-conversation.
 * (That can't happen today — agent switch resets the chat — but threading
 * the slug through means the rendering stays correct if we ever support
 * multi-agent conversations.)
 */
function resolveAgentForMessage(
  m: Message,
  agents: PublicAgentConfig[],
): PublicAgentConfig | undefined {
  if (m.role === 'user') return undefined;
  if ('agentSlug' in m) return agents.find((a) => a.slug === m.agentSlug);
  return undefined;
}

async function safeJson(response: Response): Promise<{ error?: string } | null> {
  try {
    return (await response.json()) as { error?: string };
  } catch {
    return null;
  }
}

function makeId(): string {
  // Crypto-quality IDs aren't needed; collision-resistant timestamps are
  // plenty for in-memory React keys.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
