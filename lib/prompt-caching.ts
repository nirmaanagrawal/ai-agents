/**
 * Helpers for Anthropic prompt caching via the AI SDK.
 *
 * Why caching matters here:
 *   Each agent has a long, static system prompt (rules, schema guidance,
 *   policy reminders). Without caching we re-pay full input cost on every
 *   visitor request. With ephemeral caching, the second hit within ~5 min
 *   pays ~10% of the input cost on the cached prefix. For a marketplace
 *   that gets the same prompts hammered repeatedly, this is the single
 *   biggest cost lever.
 *
 * How it works in AI SDK v4 + @ai-sdk/anthropic:
 *   You can't cache via the simple `system: 'string'` shorthand on
 *   generateText. You need the messages-array form, with a system message
 *   carrying `providerOptions.anthropic.cacheControl = { type: 'ephemeral' }`.
 *   This file produces that exact shape so call sites stay one line.
 *
 * Caveats:
 *   - System prompt must be ≥1024 tokens for caching to engage (Anthropic's
 *     minimum). Our agent system prompts comfortably exceed that.
 *   - Cache is per-account, per-key, per-prompt. Two agents with different
 *     system prompts get separate cache entries; they don't conflict.
 *   - `ephemeral` lifetime is ~5 minutes. Plenty for back-to-back visitor
 *     traffic; not useful for hourly batch runs.
 */
import type { CoreMessage } from 'ai';

/**
 * Build a messages array with the static system prompt cached and the
 * dynamic user content uncached. Use this everywhere we'd otherwise pass
 * `{ system, prompt }` to generateText / generateObject.
 *
 *   const messages = cachedMessages(SYSTEM_PROMPT, userContent);
 *   await generateText({ model, messages, tools });
 */
export function cachedMessages(systemPrompt: string, userContent: string): CoreMessage[] {
  return [
    {
      role: 'system',
      content: systemPrompt,
      // The provider-options shape is open-ended in CoreMessage; the
      // Anthropic provider reads `anthropic.cacheControl` specifically.
      // Other providers ignore unknown keys, so this is safe to leave
      // even if you swap providers temporarily.
      providerOptions: {
        anthropic: { cacheControl: { type: 'ephemeral' } },
      },
    },
    {
      role: 'user',
      content: userContent,
    },
  ];
}
