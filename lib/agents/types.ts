/**
 * Shared types for the agent registry.
 *
 * Why a handler-per-agent (not just a prompt string):
 *   A pure prompt-based registry breaks the moment an agent needs anything
 *   beyond "stuff the file into the model." Custom pre-processing (OCR,
 *   row-grouping, multi-step chains, tool calls) is the common case, not the
 *   exception. Forcing every agent through one generic route would either (a)
 *   bloat the route with per-slug branches or (b) push complexity into prompt
 *   engineering until prompts become unmaintainable. Letting each agent own
 *   its `buildPrompt` and `teaser` keeps the generic process route tiny and
 *   each agent contained.
 */
import type { CoreTool, LanguageModelV1 } from 'ai';
import type { ZodSchema } from 'zod';

/** Accepted file constraints surfaced to both client and server. */
export interface AcceptedFiles {
  /** File extensions, lowercase, including the leading dot. Example: ['.csv']. */
  extensions: string[];
  /** Hard limit — enforced on the server too, never trust the client. */
  maxSizeMB: number;
  maxFiles: number;
  /** Dropzone copy shown to the visitor. */
  description: string;
}

/**
 * A single named dropzone in an agent's UI.
 *
 * Agents can declare 1+ slots (Lead Qualifier: one `leads` slot; Invoice
 * Auditor: separate `invoices` and `pos` slots). Each slot renders its own
 * dropzone, posts files under its `key` in the multipart body, and is
 * validated independently server-side. `buildPrompt` receives files grouped
 * by slot key, so per-agent prompt logic never has to guess which file is
 * which.
 */
export interface FileSlot extends AcceptedFiles {
  /** Form-data field name + object key passed to buildPrompt. Stable/machine. */
  key: string;
  /** Human label shown above this dropzone (e.g., "Invoice files"). */
  label: string;
  /** If false, visitor can submit with this slot empty. Defaults to true server-side. */
  required?: boolean;
}

/**
 * Freeform context the visitor types in before uploading (e.g., ICP for
 * Lead Qualifier, policy rules for Invoice Auditor). Declaring this per-agent
 * lets each agent ask for exactly what its prompt needs, instead of forcing
 * one generic "notes" box that agents half-ignore.
 */
export interface ContextInput {
  label: string;
  placeholder?: string;
  helpText?: string;
  /** If false, the agent should still produce a reasonable result without it. */
  required: boolean;
}

/** Visitor-facing email-gate configuration. */
export interface GateConfig {
  /** Copy shown above the form. Supports `{remaining}` substitution. */
  message: string;
  ctaText: string;
  fields: Array<{
    name: string;
    type: 'email' | 'text' | 'select';
    label: string;
    required: boolean;
    /** Options for `type: 'select'`. Ignored otherwise. */
    options?: string[];
  }>;
}

/** Parsed input the agent's buildPrompt receives. */
export interface ParsedInput {
  filename: string;
  /** Plain text extracted from the file (CSV/XLSX flattened to JSON-as-text). */
  text: string;
  /** Loose bag of parser-specific metadata (row count, sheet names, etc.). */
  metadata: Record<string, unknown>;
}

/**
 * A single tool invocation captured during the research phase. Surfaced to
 * the client so the visitor can see *what* the agent actually did — the
 * core "this isn't just a prompt wrapper" signal.
 *
 * We intentionally store args + a short preview of the result, not the
 * entire response body. Some tools (webpage fetch, DDG related-topics list)
 * return kilobytes that nobody wants to render.
 */
export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  /** Short human-readable summary of the result. "Success: 3 topics" beats raw JSON. */
  summary: string;
  /** True when the tool returned an error envelope (not a thrown exception —
   *  those fail the whole run). Lets the UI show a muted "⚠ search failed" row. */
  failed: boolean;
  /** ms spent in execute(). Useful for both UX and future optimization. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Workflow (Level-3 agent) primitives
// ---------------------------------------------------------------------------

/**
 * Status of a single workflow step in the trace surfaced to the UI.
 *
 *   pending    — step was about to run when the workflow aborted
 *   running    — step is currently executing (only seen during streaming)
 *   completed  — step finished and updated state
 *   skipped    — step's `condition` returned false; step.run never called
 *   failed     — step threw or returned an error envelope
 */
export type WorkflowStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'skipped'
  | 'failed';

/**
 * One entry in the workflow trace. The UI renders this as a timeline so
 * the visitor can see what the agent did, in what order, with what
 * conditional branches taken — that's the proof-of-Level-3.
 */
export interface WorkflowStepRecord {
  id: string;
  name: string;
  description?: string;
  status: WorkflowStepStatus;
  /** Short human-readable summary of what the step did. */
  summary: string;
  /** Why a step was skipped (the human reason, not the boolean). */
  skipReason?: string;
  /** ms spent in step.run(). 0 for skipped/failed-before-start. */
  durationMs: number;
  /** Anthropic token totals for this step, if it called the model. */
  modelTokens?: number;
  /** Tool calls made *within* this step (separate from the agent's flat
   *  toolTrace, which aggregates across all steps). */
  toolCalls?: ToolCallRecord[];
}

/**
 * Context handed to each workflow step's `run` function.
 *
 * Steps get the bound `model` (so they don't have to know about getModel),
 * the agent's tool registry, and helpers to record telemetry. They can
 * choose to call generateText/generateObject/anything else on the model.
 *
 * Keep this surface small. Steps that need extra capabilities (caching,
 * retries) can implement them locally — making them universal here would
 * over-fit the framework to today's two agents.
 */
export interface WorkflowContext {
  model: LanguageModelV1;
  /** All tools the agent registered. Steps use the subset they need. */
  tools: Record<string, CoreTool>;
  /** Top-level abort propagated from the request. Honor it in long ops. */
  abortSignal: AbortSignal;
}

/**
 * One step in an agent's workflow.
 *
 * Steps mutate state by returning a `stateDelta` (shallow-merged into the
 * running state). This keeps state changes explicit and auditable —
 * easier to reason about than free mutation of a passed-in object.
 *
 * `condition` runs *before* `run` and decides whether to skip. Skip
 * decisions are part of the trace, so visitors see "Step 4: Currency
 * conversion — skipped (no cross-currency invoices)" alongside the
 * steps that did run.
 */
export interface WorkflowStep<TState> {
  id: string;
  name: string;
  description?: string;
  /** Returns true if the step should run. Defaults to always-run. The
   *  string variant lets you bake the human reason into the predicate
   *  result for the trace ("no cross-currency invoices"). */
  condition?: (state: TState) => boolean | { run: boolean; reason?: string };
  run: (
    state: TState,
    ctx: WorkflowContext,
  ) => Promise<{
    /** Shallow-merged into state. Use a new object — don't mutate. */
    stateDelta?: Partial<TState>;
    /** One-line summary shown in the trace timeline. */
    summary: string;
    /** Tool calls this step made, for the per-step trace + flat aggregate. */
    toolCalls?: ToolCallRecord[];
    /** Token usage for the step's model call(s), summed. */
    modelTokens?: number;
  }>;
}

/**
 * The full workflow definition for a Level-3 agent.
 *
 * `initialState(input)` seeds the state bag from parsed files + context.
 * `steps` run in order, each potentially conditional.
 * `finalize(state)` produces the schema-shaped output handed to the
 * teaser splitter and persisted in Redis.
 *
 * The framework validates `finalize`'s output against `agent.schema` so
 * a buggy step that drops fields fails loudly rather than silently.
 */
export interface WorkflowDefinition<TState, TOutput> {
  /** Seed the state from parsed files + visitor context. */
  initialState: (input: {
    files: Record<string, ParsedInput[]>;
    context: string;
  }) => TState;
  steps: Array<WorkflowStep<TState>>;
  /** Convert final state → schema-shaped output. */
  finalize: (state: TState) => TOutput;
}

/**
 * Result of an agent's teaser split.
 *
 *   teaser:    what the visitor sees immediately, free
 *   remaining: integer for the `{remaining}` token in the gate message
 *   gated:     true when a gate should actually show; false bypasses it
 *              (some agents may have no meaningful paywall for small inputs)
 */
export interface TeaserResult<TOutput> {
  teaser: Partial<TOutput> & Record<string, unknown>;
  remaining: number;
  gated: boolean;
}

/**
 * The full agent config. Generic over the Zod-inferred output type so
 * `buildPrompt` and `teaser` stay type-safe per-agent.
 */
export interface AgentConfig<TOutput = unknown> {
  slug: string;
  name: string;
  description: string;
  /** Emoji or short text badge — we don't pull icon libraries into the bundle. */
  icon: string;
  category: 'sales' | 'finance' | 'operations' | 'hr' | 'marketing';

  /**
   * One or more named dropzones. Always an array (single-file agents use a
   * one-element array) so the UI and route don't branch on "single vs multi
   * slot" — everything is slot-keyed end to end.
   */
  fileSlots: FileSlot[];
  /** Optional freeform context (ICP, policy, instructions). Omit to skip. */
  contextInput?: ContextInput;
  gate: GateConfig;

  llm: {
    /** Any Anthropic model ID available to your account. We keep this as
     *  a plain string so you don't have to edit this union every time
     *  Anthropic ships a new model. Verify availability with
     *  `curl https://api.anthropic.com/v1/models -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01"`. */
    model: string;
    temperature: number;
    /** Max output tokens. Input is truncated separately in the process route. */
    maxOutputTokens: number;
    /**
     * Upper bound on the research loop. Each step = one model turn, which
     * can emit multiple parallel tool calls. 5 is plenty for small batches
     * and caps worst-case latency at roughly model_latency × 5.
     *
     * Omit (or set to 1) for non-agentic single-shot runs.
     */
    maxSteps?: number;
  };

  /**
   * Tools the agent can call. Available to:
   *   - Level-2 agents: passed to `generateText` for autonomous tool use
   *     during the research phase.
   *   - Level-3 agents: any workflow step can reach into `ctx.tools` and
   *     invoke them inside the step's own `generateText` (or call them
   *     directly via tool.execute() for fully scripted flows).
   *
   * Keyed by tool name; the model uses the key verbatim. Agents without
   * tools skip the research phase entirely.
   */
  tools?: Record<string, CoreTool>;

  /**
   * Level-3 (workflow) agent definition. When present, the framework runs
   * the workflow instead of the buildPrompt → generateText/Object pipeline.
   * `buildPrompt` may still be exported for tests but is unused at runtime.
   *
   * The state generic is open-ended per agent — each agent defines what it
   * needs to track between steps. Final `finalize(state)` must return data
   * matching the agent's `schema`.
   */
  // We use a non-generic CoreTool-style wildcard for the workflow slot
  // because each agent's state shape is unique. The agent module provides
  // the concrete type internally; the registry only sees the AgentConfig
  // boundary, where state is opaque.
  workflow?: WorkflowDefinition<unknown, TOutput>;

  /** Zod schema for structured output. Also used by `streamObject`. */
  schema: ZodSchema<TOutput>;

  /**
   * Convert parsed files + visitor-supplied context into a system+user
   * prompt pair. Required for Level-1/2 agents (single-shot or tool-using).
   * Optional for Level-3 (workflow) agents — the workflow's `initialState`
   * seeds inputs and steps build their own prompts as needed.
   *
   * The route enforces "must have buildPrompt OR workflow" at runtime.
   */
  buildPrompt?: (input: {
    /**
     * Parsed files grouped by slot key. A slot with zero files uploaded
     * shows up as an empty array — the agent decides whether that's fatal
     * (check `required` on the slot) or a no-op.
     */
    files: Record<string, ParsedInput[]>;
    /** Always a string; empty when the visitor left the context field blank. */
    context: string;
  }) => { system: string; user: string };

  /**
   * Split a validated output into what's shown free vs. what's gated behind
   * the email form. Runs server-side before the response lands on the client.
   */
  teaser: (result: TOutput) => TeaserResult<TOutput>;
}

/**
 * Public-safe subset of the agent config. This is what the frontend receives
 * from `/api/agents/[slug]/config` — everything the UI needs, nothing that
 * would leak prompts or schema shape to a scraper.
 */
export interface PublicAgentConfig {
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: AgentConfig['category'];
  fileSlots: FileSlot[];
  contextInput?: ContextInput;
  gate: GateConfig;
}

export function toPublicConfig(config: AgentConfig): PublicAgentConfig {
  return {
    slug: config.slug,
    name: config.name,
    description: config.description,
    icon: config.icon,
    category: config.category,
    fileSlots: config.fileSlots,
    contextInput: config.contextInput,
    gate: config.gate,
  };
}
