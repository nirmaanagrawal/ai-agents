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
  WorkflowTraceView,
} from './agent-renderers';
import type {
  PublicAgentConfig,
  ToolCallRecord,
  WorkflowStepRecord,
} from '@/lib/agents/types';

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
  workflowTrace: WorkflowStepRecord[];
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
  workflowTrace?: WorkflowStepRecord[];
  toolTrace?: ToolCallRecord[];
}

type Message = UserMessage | GreetingMessage | ThinkingMessage | ResultMessage | ErrorMessage;

// ---------------------------------------------------------------------------
// Top-level component
// ---------------------------------------------------------------------------

export interface AgentChatProps {
  agents: PublicAgentConfig[];
  /** Optional initial agent (e.g., from URL `/agents/[slug]`). */
  initialAgentSlug?: string;
}

export default function AgentChat({ agents, initialAgentSlug }: AgentChatProps) {
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

  // Conversation transcript. Grows append-only; we never edit prior
  // messages except to mutate the gate state on a Result message in-place.
  const [messages, setMessages] = useState<Message[]>([]);

  // Track in-flight processing so we disable the composer + dropdown while
  // the agent is running. Also gives us an obvious "abort" target later.
  const abortRef = useRef<AbortController | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // ----- Agent switching --------------------------------------------------
  // When the dropdown changes, reset the conversation. If the visitor has
  // a real conversation in progress, confirm before nuking it.
  const handleAgentChange = useCallback(
    (newSlug: string) => {
      if (newSlug === selectedSlug) return;
      // "Real conversation" = anything past the initial greeting OR composer
      // already partly filled. Empty greeting → just swap.
      const hasUserMessages = messages.some((m) => m.role === 'user');
      const hasStaged =
        composerText.trim().length > 0 ||
        Object.values(composerFiles).some((arr) => arr.length > 0);
      if (hasUserMessages || hasStaged) {
        const target = agents.find((a) => a.slug === newSlug);
        if (
          !window.confirm(
            `Start a new conversation with ${target?.name ?? newSlug}? Your current chat will be cleared.`,
          )
        ) {
          return;
        }
      }
      setSelectedSlug(newSlug);
    },
    [selectedSlug, messages, composerText, composerFiles, agents],
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
      const response = await fetch(`/api/agents/${selectedAgent.slug}/process`, {
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
        replaceMessage(thinkingMsg.id, {
          id: thinkingMsg.id,
          role: 'assistant',
          kind: 'error',
          text: body?.error ?? `Processing failed (${response.status})`,
          workflowTrace: body?.workflowTrace,
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
        workflowTrace: body.workflowTrace ?? [],
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
        const response = await fetch(`/api/agents/${slug}/unlock`, {
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
          workflowTrace?: WorkflowStepRecord[];
        };
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId && m.role === 'assistant' && m.kind === 'result'
              ? {
                  ...m,
                  result: data.result,
                  toolTrace: Array.isArray(data.toolTrace) ? data.toolTrace : m.toolTrace,
                  workflowTrace: Array.isArray(data.workflowTrace)
                    ? data.workflowTrace
                    : m.workflowTrace,
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
      <div className="flex h-screen items-center justify-center text-gray-500">
        No agents available.
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      <Header
        agents={agents}
        selected={selectedAgent}
        onSelect={handleAgentChange}
        disabled={isProcessing}
      />

      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onComposerDrop}
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
        </div>
      </div>

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
}: {
  agents: PublicAgentConfig[];
  selected: PublicAgentConfig;
  onSelect: (slug: string) => void;
  disabled: boolean;
}) {
  return (
    <header className="border-b bg-white">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-2xl leading-none">{selected.icon}</span>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-gray-900">
              {selected.name}
            </h1>
            <p className="truncate text-xs text-gray-500">{selected.description}</p>
          </div>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <span className="hidden text-gray-500 sm:inline">Agent:</span>
          <select
            value={selected.slug}
            onChange={(e) => onSelect(e.target.value)}
            disabled={disabled}
            className="rounded-lg border bg-white px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {agents.map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.icon} {a.name}
              </option>
            ))}
          </select>
        </label>
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
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-base text-white shadow-sm">
      {emoji}
    </div>
  );
}

function UserMessageView({ message }: { message: UserMessage }) {
  return (
    <div className="flex items-start justify-end gap-3">
      <div className="max-w-[85%] space-y-1">
        {message.attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1">
            {message.attachments.flatMap((a) =>
              a.filenames.map((name) => (
                <span
                  key={`${a.slotKey}-${name}`}
                  className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs text-indigo-800"
                  title={`${a.slotLabel}: ${name}`}
                >
                  📎 {name}
                </span>
              )),
            )}
          </div>
        )}
        {message.text && (
          <div className="rounded-2xl rounded-tr-sm bg-indigo-600 px-4 py-2 text-sm text-white shadow-sm">
            {message.text}
          </div>
        )}
      </div>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-sm text-gray-700">
        👤
      </div>
    </div>
  );
}

function GreetingView({ agent }: { agent: PublicAgentConfig }) {
  // Auto-derived from config — keeps each agent's tone consistent without
  // requiring a hand-written greeting per agent.
  const slotsList = agent.fileSlots.map((s) => s.label.toLowerCase());
  const slotsClause =
    slotsList.length === 1
      ? `your ${slotsList[0]}`
      : slotsList.length === 2
        ? `your ${slotsList[0]} and your ${slotsList[1]}`
        : slotsList.slice(0, -1).join(', ') + ', and ' + slotsList[slotsList.length - 1];
  const ctx = agent.contextInput?.label.toLowerCase();
  const ctxClause = ctx
    ? agent.contextInput!.required
      ? ` and tell me about ${ctx}`
      : ` (optionally tell me about ${ctx} for sharper results)`
    : '';

  return (
    <div className="rounded-2xl rounded-tl-sm bg-white px-4 py-3 text-sm text-gray-800 shadow-sm">
      <p>
        Hi! I&apos;m the <strong>{agent.name}</strong>. {agent.description}
      </p>
      <p className="mt-2 text-gray-600">
        To get started, attach {slotsClause}
        {ctxClause}.
      </p>
    </div>
  );
}

function ThinkingView({ startedAt }: { startedAt: number }) {
  // Cycle through friendly status lines while the request is in flight.
  // This is theatre — we don't have streaming progress — but it's better
  // than a static "loading" for a 30-60s call.
  const stages = useMemo(
    () => [
      'Reading your files…',
      'Running the workflow steps…',
      'Cross-referencing with live data…',
      'Structuring the final report…',
    ],
    [],
  );
  const [idx, setIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const stage = window.setInterval(
      () => setIdx((i) => Math.min(i + 1, stages.length - 1)),
      4000,
    );
    const tick = window.setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => {
      window.clearInterval(stage);
      window.clearInterval(tick);
    };
  }, [stages.length, startedAt]);

  return (
    <div className="flex items-center gap-3 rounded-2xl rounded-tl-sm bg-white px-4 py-3 text-sm text-gray-700 shadow-sm">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
      <span>{stages[idx]}</span>
      <span className="ml-auto text-xs text-gray-400">{Math.round(elapsed / 1000)}s</span>
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
    <div className="space-y-3 rounded-2xl rounded-tl-sm bg-white px-4 py-3 shadow-sm">
      {message.workflowTrace.length > 0 && (
        <WorkflowTraceView trace={message.workflowTrace} />
      )}
      {message.toolTrace.length > 0 && message.workflowTrace.length === 0 && (
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
      {message.workflowTrace && message.workflowTrace.length > 0 && (
        <WorkflowTraceView trace={message.workflowTrace} />
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
    <footer className="border-t bg-white">
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
                  className="flex flex-wrap items-center gap-1 rounded-lg bg-indigo-50 px-2 py-1"
                >
                  <span className="text-xs font-medium text-indigo-700">
                    {slot.label}:
                  </span>
                  {slotFiles.map((f) => (
                    <span
                      key={f.name}
                      className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs text-gray-700"
                    >
                      📎 {f.name}
                      <button
                        type="button"
                        onClick={() => onRemoveFile(slot.key, f.name)}
                        disabled={isProcessing}
                        className="text-gray-400 hover:text-red-500 disabled:opacity-50"
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
            className="min-h-[44px] flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-50"
          />

          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            className="h-[44px] shrink-0 rounded-xl bg-indigo-600 px-4 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            Send
          </button>
        </div>

        <p className="text-center text-[11px] text-gray-400">
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
        className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-indigo-400 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
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
