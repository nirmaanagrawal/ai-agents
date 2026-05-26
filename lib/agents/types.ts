/**
 * Shared types for the agent registry — Agent SDK edition.
 *
 * Why a per-agent config (not just a prompt string):
 *   Each agent has its own file inputs, context input, gate copy, system
 *   prompt, output schema, and tool set. Centralizing this in a config
 *   object means the API route stays generic and per-agent surface lives
 *   in one file. Adding a new agent = create one file + register it.
 *
 * Agent SDK note:
 *   Unlike our earlier Vercel-AI-SDK setup, the Agent SDK runs the
 *   tool-use loop internally (`query()` is an async generator that
 *   yields messages). We don't write a workflow runner ourselves — the
 *   SDK orchestrates it. Tools are registered via an in-process MCP
 *   server, and structured output is enforced via JSON Schema (not Zod).
 */
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';

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
 * validated independently server-side.
 */
export interface FileSlot extends AcceptedFiles {
  /** Form-data field name + object key passed to the agent runner. */
  key: string;
  /** Human label shown above this dropzone (e.g., "Invoice files"). */
  label: string;
  /** If false, visitor can submit with this slot empty. Defaults to true. */
  required?: boolean;
}

/**
 * Freeform context the visitor types in before uploading (e.g., ICP for
 * Lead Qualifier, policy rules for Invoice Auditor).
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

/** Parsed input the agent's prompt builder receives. */
export interface ParsedInput {
  filename: string;
  /** Plain text extracted from the file (CSV/XLSX flattened to JSON-as-text). */
  text: string;
  /** Loose bag of parser-specific metadata (row count, sheet names, etc.). */
  metadata: Record<string, unknown>;
}

/**
 * One tool invocation captured during an agent run. Surfaced to the UI
 * so the visitor can see *what* the agent actually did — proof-of-work
 * for an autonomous agent (otherwise it's a black box).
 *
 * For the Agent SDK we extract these from the message stream — every
 * `assistant` message that contains a tool_use block becomes a record,
 * paired with the matching `tool_result` block.
 */
export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  /** Short human-readable summary of the result. */
  summary: string;
  /** True when the tool returned an error envelope. */
  failed: boolean;
  /** Wall-clock duration captured around the tool execution. */
  durationMs: number;
}

/**
 * Lightweight per-turn marker for the UI timeline.
 *
 * The Agent SDK doesn't expose declarative "workflow steps" the way our
 * old runner did, but each model turn is a meaningful boundary — we
 * record one entry per turn so the visitor sees the agent's narration
 * and tool fan-out as a sequence rather than a single black-box block.
 */
export type AgentTurnStatus = 'completed' | 'failed';

export interface AgentTurnRecord {
  /** 1-based turn index. */
  turn: number;
  status: AgentTurnStatus;
  /** Free-text the assistant produced this turn (often a 1-line plan). */
  narration?: string;
  /** Tool calls that fired during this turn. */
  toolCalls?: ToolCallRecord[];
  /** Wall-clock duration of this turn. */
  durationMs: number;
  /** Token totals for this turn, when the SDK reports them. */
  modelTokens?: number;
}

/**
 * Result of an agent's teaser split.
 *
 *   teaser:    what the visitor sees immediately, free
 *   remaining: integer for the `{remaining}` token in the gate message
 *   gated:     true when a gate should actually show; false bypasses it
 */
export interface TeaserResult<TOutput> {
  teaser: Partial<TOutput> & Record<string, unknown>;
  remaining: number;
  gated: boolean;
}

/**
 * Per-agent config consumed by the generic API route.
 *
 * Each agent owns:
 *   - its system prompt (defines persona + when to use which tool),
 *   - a function to assemble the user prompt from parsed files + context,
 *   - the JSON Schema the model's output must conform to,
 *   - the MCP server (built via `createSdkMcpServer`) that holds its tools,
 *   - the list of tool names the agent is allowed to call,
 *   - a teaser splitter that decides what's free vs. gated.
 *
 * The runner does NOT need to know any of this — it just calls
 * `runAgent(config, input)` and returns whatever shape comes back.
 */
export interface AgentConfig<TOutput = unknown> {
  slug: string;
  name: string;
  description: string;
  /** Emoji or short text badge — keeps icon library out of the bundle. */
  icon: string;
  category:
    | 'sales'
    | 'finance'
    | 'operations'
    | 'hr'
    | 'marketing'
    | 'customer-success';

  fileSlots: FileSlot[];
  contextInput?: ContextInput;
  gate: GateConfig;

  llm: {
    /** Any Anthropic model ID available to your account. Plain string so
     *  new model releases don't require a code change. */
    model: string;
    /** Cap on the agent's tool-use loop. The Agent SDK calls this
     *  `maxTurns`; we mirror its name to avoid translation confusion. */
    maxTurns: number;
  };

  /** System prompt — defines persona, rules, when to use each tool. */
  systemPrompt: string;

  /**
   * Build the user-message body from parsed files + visitor context.
   * Per-agent so the route never branches on slug.
   */
  buildUserPrompt: (input: {
    files: Record<string, ParsedInput[]>;
    context: string;
  }) => string;

  /**
   * In-process MCP server holding this agent's tool set, created via
   * `createSdkMcpServer({ name, version, tools: [...] })`.
   * Naming the server matters — tool names visible to Claude take the
   * form `mcp__{serverName}__{toolName}`.
   */
  mcpServer: McpSdkServerConfigWithInstance;

  /**
   * Names of tools (with the mcp__server__tool prefix) the agent is
   * allowed to call. Whitelist — anything not listed cannot be called.
   */
  allowedTools: string[];

  /**
   * JSON Schema (NOT Zod) for the structured output the agent must
   * produce. The Agent SDK enforces this via `outputFormat: { type:
   * 'json_schema', schema }`. Failing schema validation triggers a
   * retry, then a hard error.
   */
  outputSchema: Record<string, unknown>;

  /**
   * Split a validated output into what's shown free vs gated behind
   * the email form. Runs server-side before the response is returned.
   */
  teaser: (result: TOutput) => TeaserResult<TOutput>;

  /**
   * Opt into JD-style "dynamic wizard": the visitor uploads a single
   * trigger file (e.g. a job description), the server analyzes it
   * with Claude, and returns a custom MCQ wizard tuned to that file.
   * Only after the wizard is answered does the rest of the chat flow
   * (remaining file slots + Send) become available.
   *
   * When this is set on an agent, the chat reorders the visitor's
   * journey:
   *   1. Show only the `triggerSlot` upload (other slots hidden).
   *   2. After upload + "Generate criteria" click, POST the trigger
   *      file to /api/agents/{slug}/build-wizard.
   *   3. Render the returned WizardDefinition via the standard
   *      IcpWizard component.
   *   4. On wizard completion, reveal all other slots and the Send
   *      button — visitor uploads remaining files, runs the agent
   *      with the composed ICP as `context`.
   *
   * For agents WITHOUT this field, the chat uses the existing flow:
   * all slots visible up-front, preset wizard (if any), single Send.
   */
  dynamicWizard?: {
    /** Form-data field key of the file slot whose upload triggers
     *  wizard generation. Must reference a slot declared in
     *  `fileSlots`. */
    triggerSlot: string;
  };
}

/**
 * Public-safe subset of the agent config. What the frontend receives
 * from `/api/agents/[slug]/config` — UI essentials only, no prompts
 * or schema that a scraper could exfiltrate.
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
  /** Surfaced to the client so the chat can branch into the staged
   *  upload→build-wizard→answer→upload-rest flow. The schema details
   *  (prompts, JSON shape) stay server-side. */
  dynamicWizard?: AgentConfig['dynamicWizard'];
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
    dynamicWizard: config.dynamicWizard,
  };
}
