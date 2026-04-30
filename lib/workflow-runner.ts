/**
 * Workflow runner — executes a Level-3 agent's declarative step list.
 *
 * Why a runner instead of an imperative `run(state)` per agent:
 *   - Observability. Every step boundary is a natural place to record
 *     status, summary, duration, and tool calls. Visitors see the work
 *     as a timeline ("Step 3: Currency conversion — 1.2s, 1 tool call").
 *   - Conditional skipping is data, not code. Agents declare a
 *     `condition` predicate and the runner threads the result into the
 *     trace as "skipped — no cross-currency invoices" rather than the
 *     step silently being a no-op.
 *   - Failure isolation. A failed step throws and the runner records it
 *     plus the *remaining* steps as `pending`. Easier to diagnose than a
 *     half-mutated state from a partially-run imperative function.
 *
 * What the runner doesn't do (yet):
 *   - Retry. A failed step kills the workflow. We could add per-step
 *     `retry: { attempts, backoffMs }` but the current agents don't need it.
 *   - Persist intermediate state. Each run is one HTTP request; nothing
 *     to resume across requests. If we add async/long-running workflows
 *     later, snapshot to Redis after each step.
 *   - Parallelism. Steps run sequentially. Parallel sub-steps are an
 *     implementation detail of an individual step (it can Promise.all
 *     internally — the Invoice Auditor's per-invoice tool calls do this).
 */
import type {
  ToolCallRecord,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowStepRecord,
} from './agents/types';

export interface WorkflowRunResult<TOutput> {
  /** The schema-shaped output produced by `finalize(state)`. */
  output: TOutput;
  /** One record per declared step (in declared order), including skipped. */
  trace: WorkflowStepRecord[];
  /** Flat aggregate of every tool call across every step. The route
   *  forwards this to the UI's existing ToolTraceView so we don't have
   *  to duplicate that component's data path. */
  toolTrace: ToolCallRecord[];
  /** Sum of token usage across all steps that touched the model. */
  totalTokens: number;
}

export async function runWorkflow<TState, TOutput>(
  workflow: WorkflowDefinition<TState, TOutput>,
  input: { files: Record<string, import('./agents/types').ParsedInput[]>; context: string },
  ctx: WorkflowContext,
): Promise<WorkflowRunResult<TOutput>> {
  let state = workflow.initialState(input);
  const trace: WorkflowStepRecord[] = [];
  const toolTrace: ToolCallRecord[] = [];
  let totalTokens = 0;

  for (const step of workflow.steps) {
    // Honor a top-level abort between steps. Inside a step the model/tool
    // calls already check the signal — this catches gaps between calls.
    if (ctx.abortSignal.aborted) {
      trace.push({
        id: step.id,
        name: step.name,
        description: step.description,
        status: 'pending',
        summary: 'Aborted before this step ran',
        durationMs: 0,
      });
      continue;
    }

    // -------- Conditional skip ---------------------------------------
    if (step.condition) {
      const verdict = step.condition(state);
      const shouldRun = typeof verdict === 'boolean' ? verdict : verdict.run;
      const reason = typeof verdict === 'object' ? verdict.reason : undefined;
      if (!shouldRun) {
        trace.push({
          id: step.id,
          name: step.name,
          description: step.description,
          status: 'skipped',
          summary: reason ? `Skipped — ${reason}` : 'Skipped (condition not met)',
          skipReason: reason,
          durationMs: 0,
        });
        continue;
      }
    }

    // -------- Run -----------------------------------------------------
    const t0 = Date.now();
    try {
      const result = await step.run(state, ctx);
      const elapsed = Date.now() - t0;

      if (result.stateDelta) {
        state = { ...state, ...result.stateDelta };
      }

      const stepToolCalls = result.toolCalls ?? [];
      toolTrace.push(...stepToolCalls);
      totalTokens += result.modelTokens ?? 0;

      trace.push({
        id: step.id,
        name: step.name,
        description: step.description,
        status: 'completed',
        summary: result.summary,
        durationMs: elapsed,
        modelTokens: result.modelTokens,
        toolCalls: stepToolCalls.length > 0 ? stepToolCalls : undefined,
      });
    } catch (error) {
      const elapsed = Date.now() - t0;
      trace.push({
        id: step.id,
        name: step.name,
        description: step.description,
        status: 'failed',
        summary: `Failed: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: elapsed,
      });
      // Record remaining steps as `pending` so the UI shows the workflow
      // didn't simply stop in the middle for no reason.
      const idx = workflow.steps.indexOf(step);
      for (const remaining of workflow.steps.slice(idx + 1)) {
        trace.push({
          id: remaining.id,
          name: remaining.name,
          description: remaining.description,
          status: 'pending',
          summary: 'Not run (earlier step failed)',
          durationMs: 0,
        });
      }
      throw error;
    }
  }

  // -------- Finalize ---------------------------------------------------
  // finalize is pure (state → output); failures here are bugs in the
  // agent module, not runtime issues. Don't swallow — let them surface.
  const output = workflow.finalize(state);
  return { output, trace, toolTrace, totalTokens };
}
