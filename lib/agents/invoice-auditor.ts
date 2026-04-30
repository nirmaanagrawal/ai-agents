/**
 * Invoice Auditor agent — Level 3 (Workflow).
 *
 * Pipeline:
 *
 *   ┌──────────┐   ┌──────────────┐   ┌──────────────────┐   ┌────────┐
 *   │ Extract  │ → │ Match & Flag │ → │ Resolve (cond.)  │ → │ Decide │
 *   │  (LLM)   │   │   (code)     │   │ (tools, parallel)│   │ (LLM)  │
 *   └──────────┘   └──────────────┘   └──────────────────┘   └────────┘
 *
 *   1. Extract:       Claude reads invoice text + raw PO sheet, emits
 *                     structured invoice records.
 *   2. Match & Flag:  pure code; PO lookup, duplicate detection, currency
 *                     mismatch detection. Decides which invoices need
 *                     enrichment.
 *   3. Resolve:       conditional. Skipped if no invoice needs currency
 *                     conversion or vendor verification. Otherwise fans
 *                     out parallel tool calls (convertCurrency, searchWeb).
 *   4. Decide:        Claude applies the user's policy to enriched data
 *                     and emits per-invoice decisions + summary roll-ups.
 *
 * Why this shape:
 *   - Multi-step reasoning: each step has a single, scoped responsibility.
 *     Easier to debug than one mega-prompt.
 *   - Memory: state threads between steps; later steps cite earlier
 *     findings (e.g., the Decide step's reasoning quotes the Resolve
 *     step's converted amounts).
 *   - Conditional logic: Resolve only runs when needed — visible in the
 *     trace as "skipped — no cross-currency invoices and all PO matched".
 *   - Cheaper: pure-code matching is free; the conditional skip avoids
 *     unnecessary API hits on clean batches.
 *
 * Why two LLM calls (extract + decide) instead of one:
 *   Asking Claude to extract AND decide AND format in a single call works
 *   for tiny inputs but fragments at scale. Splitting lets us cache the
 *   long static system prompts (one per phase) and use temperature: 0
 *   for the deterministic decide phase while leaving extract slightly
 *   higher to cope with messy PDF layouts.
 */
import { generateObject } from 'ai';
import { z } from 'zod';
import { truncateForModel } from '@/lib/parse-file';
import { cachedMessages } from '@/lib/prompt-caching';
import { convertCurrency, searchWeb } from '@/lib/tools';
import type {
  AgentConfig,
  ParsedInput,
  ToolCallRecord,
  WorkflowDefinition,
  WorkflowStep,
} from './types';

// ---------------------------------------------------------------------------
// Output schemas (preserved from the Level-2 version)
// ---------------------------------------------------------------------------

const InvoiceAuditSchema = z.object({
  invoiceNumber: z.string(),
  vendor: z.string(),
  amount: z.number(),
  currency: z.string().optional(),
  poNumber: z.string().nullable(),
  matchStatus: z.enum(['EXACT', 'WITHIN_TOLERANCE', 'VARIANCE', 'NO_PO', 'DUPLICATE']),
  discrepancies: z.array(z.string().max(200)),
  decision: z.enum(['AUTO_APPROVE', 'ROUTE_TO_MANAGER', 'ROUTE_TO_CFO', 'REJECT']),
  reasoning: z.string().max(320),
  suggestedAction: z.string().max(280),
});

const InvoiceAuditorOutputSchema = z.object({
  totalInvoices: z.number().int(),
  autoApproveCount: z.number().int(),
  needsReviewCount: z.number().int(),
  rejectedCount: z.number().int(),
  totalValueUSD: z.number(),
  potentialSavingsUSD: z.number(),
  invoices: z.array(InvoiceAuditSchema),
});

export type InvoiceAuditorOutput = z.infer<typeof InvoiceAuditorOutputSchema>;

// ---------------------------------------------------------------------------
// Internal state types (workflow-private; not exposed through schema)
// ---------------------------------------------------------------------------

interface PORecord {
  poNumber: string;
  vendor?: string;
  amount?: number;
  currency?: string;
  raw: Record<string, unknown>;
}

const ExtractedInvoiceSchema = z.object({
  sourceFile: z.string(),
  invoiceNumber: z.string(),
  vendor: z.string(),
  amount: z.number(),
  currency: z.string().describe('ISO 4217 code if present, else USD'),
  poReference: z.string().nullable().describe('PO number referenced on the invoice, or null'),
});
type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema>;

interface MatchedInvoice extends ExtractedInvoice {
  matchedPO: PORecord | null;
  matchStatus: 'EXACT' | 'WITHIN_TOLERANCE' | 'VARIANCE' | 'NO_PO' | 'DUPLICATE';
  flags: string[];
  needsCurrencyConversion: boolean;
  needsVendorVerification: boolean;
}

interface ResolvedInvoice extends MatchedInvoice {
  /** Amount converted into the matched PO's currency, if applicable. */
  convertedAmount?: number;
  conversionRate?: number;
  conversionTarget?: string;
  /** Result of vendor lookup when matchStatus was NO_PO. */
  vendorVerification?: {
    found: boolean;
    description?: string;
    source?: string;
  };
}

interface AuditorState {
  // ---- Seed (initialState) ------------------------------------------
  invoiceFiles: ParsedInput[];
  poFile?: ParsedInput;
  policy: string;

  // ---- After Extract ------------------------------------------------
  extracted?: ExtractedInvoice[];
  pos?: PORecord[];

  // ---- After Match & Flag -------------------------------------------
  matched?: MatchedInvoice[];

  // ---- After Resolve (or skipped) -----------------------------------
  resolved?: ResolvedInvoice[];

  // ---- After Decide -------------------------------------------------
  finalOutput?: InvoiceAuditorOutput;
}

// ---------------------------------------------------------------------------
// System prompts (cached via prompt-caching helpers)
// ---------------------------------------------------------------------------

const EXTRACT_SYSTEM_PROMPT = `You are the extraction phase of an
accounts-payable audit pipeline. Your sole job is to read raw invoice
text (extracted from PDFs or batch CSV/XLSX exports) and emit one
structured record per invoice.

Rules:
  - Each invoice file may contain ONE invoice (typical PDF) or MANY
    invoices (CSV/XLSX export with one row per invoice). Detect which
    by content; emit one record per invoice either way.
  - "amount" is the total payable on the invoice. Strip currency
    symbols/separators and emit a plain number (1240.50, not "$1,240.50").
  - "currency" is the ISO 4217 code. If absent, default to USD and the
    downstream pipeline will treat it accordingly. Never invent a
    non-standard code.
  - "poReference" is the PO number the invoice cites, or null if it
    references no PO. Do NOT guess based on vendor; missing means missing.
  - "sourceFile" is the file the invoice came from (use the [FILE: ...]
    marker in the input).
  - Never invent invoices. If a file has no extractable invoice content,
    omit it from the output rather than fabricating one.`;

const DECIDE_SYSTEM_PROMPT = `You are the final decision phase of an
accounts-payable audit pipeline. Earlier phases have already:
  - extracted structured fields from each invoice,
  - looked up matching POs and flagged anomalies,
  - converted cross-currency amounts via live FX rates,
  - verified suspicious vendors via web search.

Your job: apply the user's approval policy to the enriched data and
emit per-invoice decisions plus summary roll-ups.

Decision rules:
  - Apply the policy STRICTLY. Honor dollar thresholds and approval chains
    exactly as written. Never auto-approve when matchStatus is VARIANCE,
    DUPLICATE, or NO_PO unless the policy explicitly says so.
  - Use the converted amount (if present) for tolerance comparisons.
    Never compare raw amounts across currencies.
  - "reasoning" must cite actual numbers from the enriched record. Quote
    the FX conversion ("€1,000 = $1,080 @ 1.08, +2.9% over PO of $1,050")
    or the vendor verification ("DDG returned no abstract for vendor —
    treating as unverified").
  - "discrepancies" lists concrete issues. Empty array when the invoice
    is clean.
  - "suggestedAction" is one concrete next step an AP clerk can take
    today, not a generic "review it".

Accounting rules:
  - totalInvoices / autoApproveCount / needsReviewCount / rejectedCount
    must match the returned array exactly. needsReviewCount is manager+CFO.
  - totalValueUSD is the sum of converted (or native, if USD) amounts.
  - potentialSavingsUSD is overcharges flagged + full amounts of
    DUPLICATE and REJECT decisions.
  - If the policy is empty, fall back to: 2% tolerance, auto-approve
    only under $1,000 with EXACT match, everything else routes to manager.`;

// ---------------------------------------------------------------------------
// Step 1 — Extract
// ---------------------------------------------------------------------------

const extractStep: WorkflowStep<AuditorState> = {
  id: 'extract',
  name: 'Extract invoice fields',
  description: 'Claude reads each invoice file and emits structured records.',
  async run(state, ctx) {
    const invoicesBlock = state.invoiceFiles
      .map((f) => {
        const body = truncateForModel(f.text, 4_000);
        const meta =
          'pageCount' in f.metadata
            ? `(${f.metadata.pageCount} pages)`
            : 'rowCount' in f.metadata
              ? `(${f.metadata.rowCount} rows)`
              : '';
        return `[FILE: ${f.filename}] ${meta}\n${body}`;
      })
      .join('\n\n---\n\n');

    const result = await generateObject({
      model: ctx.model,
      schema: z.object({ invoices: z.array(ExtractedInvoiceSchema) }),
      messages: cachedMessages(
        EXTRACT_SYSTEM_PROMPT,
        `Invoice files (${state.invoiceFiles.length}):\n\n${invoicesBlock}`,
      ),
      temperature: 0,
      abortSignal: ctx.abortSignal,
    });

    // PO file is parsed deterministically — the parseFile step already
    // converted CSV/XLSX → JSON-as-text, so JSON.parse round-trips it
    // back into rows. Cheaper and more reliable than asking the LLM.
    const pos = state.poFile ? parsePOFile(state.poFile) : [];

    return {
      stateDelta: { extracted: result.object.invoices, pos },
      summary:
        `Extracted ${result.object.invoices.length} invoice(s) from ` +
        `${state.invoiceFiles.length} file(s); parsed ${pos.length} PO(s) from reference sheet.`,
      modelTokens: result.usage?.totalTokens,
    };
  },
};

// ---------------------------------------------------------------------------
// Step 2 — Match & Flag (pure code)
// ---------------------------------------------------------------------------

const matchAndFlagStep: WorkflowStep<AuditorState> = {
  id: 'match-and-flag',
  name: 'Match POs and flag anomalies',
  description:
    'Pure code. Looks up PO by number, detects duplicate invoices and ' +
    'currency mismatches, decides which invoices need enrichment.',
  async run(state) {
    const invoices = state.extracted ?? [];
    const pos = state.pos ?? [];

    // Pre-compute occurrence counts for duplicate detection. Same
    // (invoiceNumber, vendor) pair appearing twice in the same batch is
    // the canonical AP duplicate signal.
    const dupKey = (i: ExtractedInvoice) =>
      `${i.invoiceNumber.toLowerCase()}|${i.vendor.toLowerCase()}`;
    const dupCounts = new Map<string, number>();
    for (const inv of invoices) {
      const k = dupKey(inv);
      dupCounts.set(k, (dupCounts.get(k) ?? 0) + 1);
    }

    const matched: MatchedInvoice[] = invoices.map((inv) => {
      const matchedPO = findMatchingPO(inv, pos);
      const flags: string[] = [];

      const isDup = (dupCounts.get(dupKey(inv)) ?? 0) > 1;
      if (isDup) flags.push('Duplicate (invoice#, vendor) appears multiple times in batch');

      const poCurrency = matchedPO?.currency ?? inv.currency;
      const needsCurrencyConversion =
        matchedPO != null && inv.currency !== poCurrency;
      if (needsCurrencyConversion) {
        flags.push(`Cross-currency: invoice ${inv.currency} vs PO ${poCurrency}`);
      }

      // We only verify vendors when there's no matching PO — that's the
      // legitimate auditor reflex ("I have no PO for this; does this
      // vendor even exist?"). Avoids burning DDG quota on every row.
      const matchStatus: MatchedInvoice['matchStatus'] = isDup
        ? 'DUPLICATE'
        : !matchedPO
          ? 'NO_PO'
          : 'EXACT';
      const needsVendorVerification = matchStatus === 'NO_PO';
      if (needsVendorVerification) {
        flags.push('No matching PO — will verify vendor exists');
      }

      return {
        ...inv,
        matchedPO,
        matchStatus,
        flags,
        needsCurrencyConversion,
        needsVendorVerification,
      };
    });

    const matchedCount = matched.filter((m) => m.matchedPO).length;
    const flaggedCount = matched.filter((m) => m.flags.length > 0).length;
    return {
      stateDelta: { matched },
      summary:
        `${matchedCount}/${matched.length} invoices matched to a PO; ` +
        `${flaggedCount} flagged for further inspection.`,
    };
  },
};

// ---------------------------------------------------------------------------
// Step 3 — Resolve (conditional, parallel tool calls)
// ---------------------------------------------------------------------------

const resolveStep: WorkflowStep<AuditorState> = {
  id: 'resolve',
  name: 'Resolve anomalies (currency + vendor)',
  description:
    'Calls live FX and web-search APIs to enrich flagged invoices. ' +
    'Skipped entirely if the prior step found no anomalies worth resolving.',
  condition(state) {
    const m = state.matched ?? [];
    const needsCurrency = m.some((i) => i.needsCurrencyConversion);
    const needsVendor = m.some((i) => i.needsVendorVerification);
    if (!needsCurrency && !needsVendor) {
      return {
        run: false,
        reason: 'all invoices match a PO and use the same currency',
      };
    }
    return true;
  },
  async run(state, ctx) {
    const matched = state.matched ?? [];
    const toolCalls: ToolCallRecord[] = [];

    // Run all tool calls in parallel — they're independent. With ~5
    // invoices typical, parallelism cuts wall time from ~6s to ~1s.
    const conversionPromises = matched
      .filter((i) => i.needsCurrencyConversion)
      .map(async (inv) => {
        const target = inv.matchedPO?.currency ?? inv.currency;
        const t0 = Date.now();
        // Tool execution is invoked directly (not via the model) because
        // we already know exactly which call to make. The CoreTool's
        // .execute is callable with a minimal options object.
        const result = (await convertCurrency.execute!(
          { amount: inv.amount, from: inv.currency, to: target },
          { abortSignal: ctx.abortSignal, toolCallId: `conv-${inv.invoiceNumber}`, messages: [] },
        )) as Record<string, unknown>;
        const failed = typeof result.error === 'string';
        toolCalls.push({
          tool: 'convertCurrency',
          args: { amount: inv.amount, from: inv.currency, to: target },
          summary: failed
            ? `error: ${String(result.error)}`
            : `${inv.amount} ${inv.currency} → ${result.converted} ${target} @ ${result.rate}`,
          failed,
          durationMs: Date.now() - t0,
        });
        return { invoiceNumber: inv.invoiceNumber, target, result };
      });

    const verificationPromises = matched
      .filter((i) => i.needsVendorVerification)
      .map(async (inv) => {
        const t0 = Date.now();
        const result = (await searchWeb.execute!(
          { query: inv.vendor },
          { abortSignal: ctx.abortSignal, toolCallId: `vend-${inv.invoiceNumber}`, messages: [] },
        )) as Record<string, unknown>;
        const failed = typeof result.error === 'string';
        toolCalls.push({
          tool: 'searchWeb',
          args: { query: inv.vendor },
          summary: failed
            ? `error: ${String(result.error)}`
            : result.empty
              ? 'no DDG abstract — vendor unverified'
              : `${(result.heading as string) || 'ok'}${result.abstractSource ? ` · via ${result.abstractSource}` : ''}`,
          failed,
          durationMs: Date.now() - t0,
        });
        return { invoiceNumber: inv.invoiceNumber, result };
      });

    const [conversions, verifications] = await Promise.all([
      Promise.all(conversionPromises),
      Promise.all(verificationPromises),
    ]);

    // Stitch enrichments back per-invoice. Missing entries (invoice didn't
    // need the tool) just leave the optional fields undefined — the Decide
    // step renders cleanly either way.
    const resolved: ResolvedInvoice[] = matched.map((inv) => {
      const conv = conversions.find((c) => c.invoiceNumber === inv.invoiceNumber);
      const ver = verifications.find((v) => v.invoiceNumber === inv.invoiceNumber);
      const enriched: ResolvedInvoice = { ...inv };
      if (conv && !conv.result.error) {
        enriched.convertedAmount = conv.result.converted as number;
        enriched.conversionRate = conv.result.rate as number;
        enriched.conversionTarget = conv.target;
      }
      if (ver) {
        const verResult = ver.result;
        enriched.vendorVerification = {
          found: !verResult.empty && !verResult.error,
          description:
            typeof verResult.abstract === 'string' ? verResult.abstract : undefined,
          source:
            typeof verResult.abstractSource === 'string'
              ? verResult.abstractSource
              : undefined,
        };
      }
      return enriched;
    });

    return {
      stateDelta: { resolved },
      summary:
        `Converted ${conversions.length} cross-currency invoice(s); ` +
        `verified ${verifications.length} vendor(s) via DDG.`,
      toolCalls,
    };
  },
};

// ---------------------------------------------------------------------------
// Step 4 — Decide
// ---------------------------------------------------------------------------

const decideStep: WorkflowStep<AuditorState> = {
  id: 'decide',
  name: 'Apply policy and decide',
  description: 'Claude applies the user policy to enriched invoices and emits final decisions.',
  async run(state, ctx) {
    // resolved trumps matched (richer); fall back to matched if Resolve
    // was skipped.
    const invoices = state.resolved ?? state.matched ?? [];
    const enrichedJson = JSON.stringify(invoices, null, 2);

    const result = await generateObject({
      model: ctx.model,
      schema: InvoiceAuditorOutputSchema,
      messages: cachedMessages(
        DECIDE_SYSTEM_PROMPT,
        `APPROVAL POLICY (apply strictly):
${state.policy.trim() || '(no policy provided — use conservative defaults)'}

---

ENRICHED INVOICES (one record per invoice; conversions and vendor verifications already applied where applicable):

${enrichedJson}`,
      ),
      temperature: 0,
      abortSignal: ctx.abortSignal,
    });

    return {
      stateDelta: { finalOutput: result.object },
      summary:
        `Decided: ${result.object.autoApproveCount} auto-approve, ` +
        `${result.object.needsReviewCount} review, ` +
        `${result.object.rejectedCount} reject` +
        (result.object.potentialSavingsUSD > 0
          ? ` (${formatUSD(result.object.potentialSavingsUSD)} potential savings flagged)`
          : ''),
      modelTokens: result.usage?.totalTokens,
    };
  },
};

// ---------------------------------------------------------------------------
// Workflow definition
// ---------------------------------------------------------------------------

const invoiceAuditorWorkflow: WorkflowDefinition<AuditorState, InvoiceAuditorOutput> = {
  initialState({ files, context }) {
    return {
      invoiceFiles: files.invoices ?? [],
      poFile: files.pos?.[0],
      policy: context,
    };
  },
  steps: [extractStep, matchAndFlagStep, resolveStep, decideStep],
  finalize(state) {
    if (!state.finalOutput) {
      // Means decideStep didn't run — should only happen if a prior step
      // failed. The runner already records that failure; this turns the
      // "no output" into a clear server error rather than a silent empty.
      throw new Error('Workflow finished without producing final output');
    }
    return state.finalOutput;
  },
};

// ---------------------------------------------------------------------------
// Agent config
// ---------------------------------------------------------------------------

export const invoiceAuditor: AgentConfig<InvoiceAuditorOutput> = {
  slug: 'invoice-auditor',
  name: 'Invoice Auditor',
  description:
    'Match invoices to POs, catch overcharges and duplicates, route each one to the right approver — in seconds.',
  icon: '🧾',
  category: 'finance',

  fileSlots: [
    {
      key: 'invoices',
      label: 'Invoices',
      extensions: ['.pdf', '.csv', '.xlsx', '.xls'],
      maxSizeMB: 10,
      maxFiles: 5,
      description: 'Drop invoice PDFs or a batch export (CSV / Excel)',
      required: true,
    },
    {
      key: 'pos',
      label: 'Purchase Orders',
      extensions: ['.csv', '.xlsx', '.xls'],
      maxSizeMB: 5,
      maxFiles: 1,
      description: 'Drop your PO reference sheet',
      required: true,
    },
  ],

  contextInput: {
    label: 'Your approval policy',
    placeholder:
      'e.g., Match tolerance ±3% on unit price, ±5% on total. ' +
      'Auto-approve under $5k with exact match. $5k-$25k → manager. ' +
      '>$25k → CFO. Flag duplicate invoice# + vendor in last 90 days.',
    helpText:
      'Describe your tolerances, approval thresholds, and routing rules. The more specific, the sharper the audit. Required.',
    required: true,
  },

  gate: {
    message:
      '{remaining} more invoices audited with discrepancies flagged and routing decisions ready. Drop your email for the full report.',
    ctaText: 'Unlock Full Audit',
    fields: [
      { name: 'email', type: 'email', label: 'Work email', required: true },
      {
        name: 'companySize',
        type: 'select',
        label: 'Company size',
        required: false,
        options: ['1-10', '11-50', '51-200', '201-1000', '1000+'],
      },
      {
        name: 'apVolume',
        type: 'select',
        label: 'Monthly invoice volume',
        required: false,
        options: ['<100', '100-500', '500-2000', '2000+'],
      },
    ],
  },

  llm: {
    model: 'claude-haiku-4-5',
    temperature: 0.1,
    maxOutputTokens: 6000,
    // Workflow agent — `maxSteps` no longer drives a single tool loop.
    // Each workflow step controls its own model usage (most use 1 call).
  },

  // Tools are still declared at the agent level so the registry knows
  // about them (for permission audits, UI badges, etc.) but the workflow
  // calls them directly via tool.execute() rather than via autonomous LLM.
  tools: { convertCurrency, searchWeb },

  workflow: invoiceAuditorWorkflow as WorkflowDefinition<unknown, InvoiceAuditorOutput>,

  schema: InvoiceAuditorOutputSchema,

  teaser(result) {
    const TEASER_COUNT = 3;
    const invoices = result.invoices ?? [];
    const shown = invoices.slice(0, TEASER_COUNT);
    const remaining = Math.max(0, invoices.length - shown.length);
    return {
      teaser: { ...result, invoices: shown },
      remaining,
      gated: remaining > 0,
    };
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the PO reference sheet from its already-stringified-JSON form.
 * `parseFile` produces `text = JSON.stringify(rows)` for CSV/XLSX, which
 * round-trips cleanly via JSON.parse — we don't need a second parser pass.
 */
function parsePOFile(file: ParsedInput): PORecord[] {
  let rows: Array<Record<string, unknown>>;
  try {
    rows = JSON.parse(file.text);
    if (!Array.isArray(rows)) return [];
  } catch {
    return [];
  }

  // PO sheets in the wild use wildly different column names (PO Number,
  // PO#, PO Ref, OrderNumber, …). We do a best-effort lookup by lowercased
  // key suffix. Same for vendor + amount.
  return rows
    .map((row): PORecord | null => {
      const lookup = (suffixes: string[]): unknown => {
        for (const [k, v] of Object.entries(row)) {
          const lk = k.toLowerCase().replace(/[\s_-]/g, '');
          if (suffixes.some((s) => lk.includes(s))) return v;
        }
        return undefined;
      };
      const poNumberRaw = lookup(['ponumber', 'po#', 'poid', 'orderno', 'ordernumber']);
      const vendorRaw = lookup(['vendor', 'supplier', 'payee']);
      const amountRaw = lookup(['amount', 'total', 'value', 'subtotal']);
      const currencyRaw = lookup(['currency', 'ccy']);

      const poNumber = String(poNumberRaw ?? '').trim();
      if (!poNumber) return null; // row without a PO number is unusable

      return {
        poNumber,
        vendor: vendorRaw ? String(vendorRaw) : undefined,
        amount: typeof amountRaw === 'number' ? amountRaw : parseAmount(String(amountRaw ?? '')),
        currency: currencyRaw ? String(currencyRaw).toUpperCase() : undefined,
        raw: row,
      };
    })
    .filter((p): p is PORecord => p !== null);
}

function parseAmount(s: string): number | undefined {
  // Strip currency symbols, thousand separators, spaces. Keep digits, dot,
  // minus. Don't do locale-aware parsing — too many edge cases for this
  // marketplace; if it doesn't parse cleanly we leave it undefined.
  const cleaned = s.replace(/[^\d.\-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Find the matching PO for an invoice. Exact match on PO number first,
 * then fuzzy by vendor + nearest amount. Conservative: returns null
 * rather than guessing across vendors.
 */
function findMatchingPO(inv: ExtractedInvoice, pos: PORecord[]): PORecord | null {
  if (inv.poReference) {
    const exact = pos.find(
      (p) => p.poNumber.toLowerCase() === inv.poReference!.toLowerCase(),
    );
    if (exact) return exact;
  }

  // Fuzzy: same vendor + nearest amount within 20% of invoice total.
  const sameVendor = pos.filter(
    (p) => p.vendor && p.vendor.toLowerCase() === inv.vendor.toLowerCase(),
  );
  if (sameVendor.length === 0) return null;
  const candidate = sameVendor
    .filter((p) => typeof p.amount === 'number')
    .map((p) => ({ p, diff: Math.abs((p.amount as number) - inv.amount) }))
    .sort((a, b) => a.diff - b.diff)[0];
  if (candidate && candidate.diff / inv.amount < 0.2) return candidate.p;

  return null;
}

function formatUSD(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}
