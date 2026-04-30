# AI Agent Marketplace — Minimal Scaffold

A config-driven AI agent marketplace on Next.js 15 + Vercel. Ships with one
working agent (Lead Qualifier) end-to-end: drag-drop upload → streamed
partial results → email gate → full result.

## What's here

```
app/
  agents/[slug]/page.tsx         → Landing page per agent
  api/agents/[slug]/
    config/route.ts              → Public agent metadata
    process/route.ts             → File upload + streamObject (NDJSON stream)
    unlock/route.ts              → Email gate exchange
  page.tsx                       → Marketplace listing
components/
  AgentCard.tsx                  → The reusable widget (drop, stream, gate)
lib/
  agents/
    types.ts                     → AgentConfig interface
    registry.ts                  → Slug → config map
    lead-qualifier.ts            → One complete agent (prompt + schema + teaser)
  llm.ts                         → openai() provider (reads OPENAI_API_KEY)
  parse-file.ts                  → CSV / XLSX parsers
  redis.ts                       → Upstash client + rate limiter
middleware.ts                    → Per-IP rate limit on /process and /unlock
```

## Adding an agent

1. Copy `lib/agents/lead-qualifier.ts` to `lib/agents/your-agent.ts`.
2. Change the slug, name, Zod schema, prompt, and `teaser()` function.
3. Import and register in `lib/agents/registry.ts`.

No route code changes. No UI code changes (for agents that share the
lead-list output shape). For different output shapes (invoice audits,
document summaries), add a per-agent results component and branch in
`AgentCard.tsx` on the agent's output shape — or, when you have more than
two shapes, lift the results view into a per-agent React component that the
registry points to.

## Setup

```bash
npm install
cp .env.local.example .env.local   # then fill in the keys
npm run dev
```

You'll need:

- **OpenAI API key** — https://platform.openai.com/api-keys
- **Upstash Redis** (free tier is fine) — https://upstash.com/
  Create a database, copy the REST URL and REST token.

Visit http://localhost:3000 and try the Lead Qualifier with any lead CSV
(columns like name, email, company, title, notes).

## What's deliberately omitted

This is the minimal end-to-end scaffold — things to add when you outgrow it:

- **PDF parsing**: `pdf-parse` has a fixture-probe bug on serverless. Use
  `unpdf` or import `pdf-parse/lib/pdf-parse.js` directly.
- **Email delivery**: the unlock route returns the result but doesn't email
  it yet. Drop in Resend (`resend.emails.send`) inside the unlock handler.
- **Bot protection**: `.env.local.example` reserves `TURNSTILE_*` keys.
  Verify the Turnstile token at the top of the `/process` handler before
  calling `streamObject`. Without it, you rely on the IP rate limit alone.
- **Iframe embed page + widget.js script**: trivial to add — one more route
  (`app/agents/[slug]/embed/page.tsx`) that renders `<AgentCard embedded />`,
  plus a small static script in `public/`.
- **Marketplace search/filter**: the listing is a plain grid right now.
  Category tabs + client-side filter when you pass ~10 agents.
- **Per-agent results UI**: the current `ResultsView` is shaped for
  lead-list output. Swap in a component map when you add agents with
  different output shapes.

## Key architectural decisions

- **NDJSON stream, not AI SDK's text-stream response.** `streamObject`'s
  built-in `toTextStreamResponse()` ships a JSON blob as it's generated,
  which the client can only `JSON.parse` at the end. We convert
  `partialObjectStream` to NDJSON (one JSON per line), so every line parses
  cleanly and the client can render progressively.

- **`onFinish` persists the full result.** The stream is consumed by the
  client for UI updates; the server persists the validated final object to
  Redis. `/unlock` reads from Redis — it does not re-run the model.

- **Per-agent `buildPrompt` and `teaser`.** Prompts-as-strings break the
  moment an agent needs pre-processing. Each agent owns how its input becomes
  a prompt and how its output is split into teaser + gated — the generic
  route never branches on slug.

- **Rate limit at the Edge, validation in the route.** Middleware blocks
  floods before they spin up a Node function. The route double-checks
  required gate fields so a scripted POST can't skip the form.

## Running on Vercel

```bash
vercel deploy
```

Set the env vars (`OPENAI_API_KEY`, `UPSTASH_REDIS_REST_URL`,
`UPSTASH_REDIS_REST_TOKEN`, optional `LEAD_WEBHOOK_URL`) in the Vercel
dashboard. On the Hobby plan, `maxDuration` caps at 60s — the route is
configured for that. Pro plan lets you raise it to 300s in
`app/api/agents/[slug]/process/route.ts`.
