/**
 * LLM client wrapper.
 *
 * Why this file exists despite being thin:
 *   - It's the one place that reads ANTHROPIC_API_KEY. If you ever switch
 *     to Bedrock, Vertex, or a multi-provider router, this is the only
 *     file that changes.
 *   - The AI SDK's `anthropic` provider reads ANTHROPIC_API_KEY from env
 *     automatically — DO NOT call `anthropic(process.env.ANTHROPIC_API_KEY)`.
 *     That passes the key as a *model name* and fails with a cryptic error.
 *     (This is the single most common copy-paste mistake from older SDK docs.)
 *
 * Why Claude (and not OpenAI):
 *   We picked Anthropic for two reasons:
 *     1. Strong tool-use + multi-step workflows (Level 2/3 of our agent
 *        ladder). Claude's tool calling is native to the chat format and
 *        plays well with parallel tool calls in `generateText`.
 *     2. Built-in prompt caching via the `cacheControl` provider option,
 *        which we use on the agents' static system prompts. Marketplace
 *        traffic re-uses the same prompts repeatedly, so caching slashes
 *        the per-call cost on the system block.
 *
 *   The AI SDK abstracts the wire format — swap providers later by
 *   changing only this file (plus model strings in agent configs).
 */
import { anthropic } from '@ai-sdk/anthropic';

/**
 * Returns a LanguageModelV1 wired to ANTHROPIC_API_KEY.
 *
 * `name` is typed as `string` on purpose — Anthropic ships new model IDs
 * regularly (`claude-sonnet-4-5`, `claude-haiku-4-5`, `claude-opus-4-7`,
 * …) and a union here means editing this file for every release. Verify
 * availability with:
 *
 *   curl https://api.anthropic.com/v1/models \
 *     -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01"
 *
 * Cost reference (rough): Haiku-class is ~5-10× cheaper than Sonnet-class
 * for the same workload. We default agents to Haiku because the workflow
 * pattern decomposes the work into small, focused calls — each call needs
 * less raw reasoning power than a monolithic prompt would.
 */
export function getModel(name: string) {
  return anthropic(name);
}

/**
 * The default model new agents should use unless they have a specific
 * reason otherwise. Centralizing the default means a single edit upgrades
 * every agent to the next Haiku release.
 */
export const DEFAULT_MODEL = 'claude-haiku-4-5';
