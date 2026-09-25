# Grok Generative UI

Ask what X thinks about anything. `grok-4.6` runs xAI's **X Search** server-side,
then composes the answer out of real React components through CopilotKit frontend
tools — it picks which components appear and what goes in them. There is no fixed
dashboard being filled in.

Every post on screen is a real post the model found. Nothing is authored by hand.

![Grok composing the dashboard](./demo.png)

**Stack:** Next.js 16 + CopilotKit v2 (`@copilotkit/react-core/v2`) + `BuiltInAgent`
pointed at `xai.responses("grok-4.6")`

**Highlights:**

- 5 frontend tools registered via `useFrontendTool` — one search, four renderers
- `x_search` runs on xAI's infrastructure; no X/Twitter API credentials involved
- Headless `CopilotChatView` composed into the page layout, so the composer is the
  page's own input when centered and the rail's input once a run starts
- Paint-in reveal: each panel walks skeleton → wireframe → rendered as its tool lands
- Disk cache for search results so the demo replays in ~1s instead of 45–90s

## Prerequisites

- Node.js 20+
- An [xAI API key](https://console.x.ai) with access to `grok-4.6` and the
  `x_search` server-side tool

## Run locally

```bash
git clone https://github.com/CopilotKit/CopilotKit.git
cd CopilotKit/examples/showcases/grok-generative-ui
cp .env.example .env.local   # then put your XAI_API_KEY in .env.local
npm install
npm run warm                 # optional; pre-fetches the starter prompts
npm run dev
```

Open <http://localhost:3000> and ask **what is X saying about grok 4.6?**

### The cache

A cold `x_search` costs 45–90s, which makes iterating painful. `npm run warm` runs
the three starter prompts once and writes the results to `.cache/x-search/`; after
that they return in about a second.

Entries come from real searches, so a cache hit renders exactly what a live run
would — it buys latency, not fidelity. `npm run warm -- --fresh` re-searches, and
any topic outside the warmed set still hits the live API.

The cache keys on the topic **the agent extracts**, not on what you type:
`"what is X saying about grok 4.6?"` reaches `searchX` as `"grok 4.6"`. Lookup folds
case and punctuation and falls back to substring containment.

## How it works

```
you ──▶ CopilotKit runtime ──▶ BuiltInAgent(model: xai.responses("grok-4.6"))
                                     │
                                     │   all five are FRONTEND tools
                                     ├─ searchX ──▶ POST /api/x-search
                                     │                └─ x_search  ← runs on xAI
                                     ├─ renderSummary          ┐
                                     ├─ renderSentimentSplit   │
                                     ├─ renderArgumentMap      ├─▶ your components
                                     └─ renderReceipts         ┘
```

### Every tool is a frontend tool — deliberately

An earlier version registered `searchX` as a backend `ToolDefinition` on
`BuiltInAgent` while the renderers came from `useFrontendTool`. Mixing the two
stopped the frontend tools from reaching the model at all: it reported them as
"not available in my current setup" and narrated fabricated results instead of
rendering.

All five are frontend tools now, so they reach the model through one path.
`searchX` is a thin client that POSTs to `/api/x-search`, which is where `x_search`
actually executes.

### Runs must go through `copilotkit.runAgent`

```ts
// wrong — runs without the tools registered by useFrontendTool
await agent.runAgent();

// right — attaches them
await copilotkit.runAgent({ agent });
```

The raw AG-UI method hands the model an empty toolset, producing the same
"tools unavailable" symptom.

### Why `searchX` wraps `x_search` instead of exposing it directly

xAI's Responses API runs server-side tools on their infrastructure and will not
accept client-side function tools in the same request. CopilotKit frontend tools
_are_ client-side function tools, so the two can never appear together. `x_search`
therefore runs inside `lib/x-search.ts`, isolated, as the only tool in its request.

### Why a model instance, not a model string

`BuiltInAgent` accepts `BuiltInAgentModel | LanguageModel`. The string
`"xai:grok-4.6"` routes through the built-in provider list;
`xai.responses("grok-4.6")` points at xAI's Responses API directly, which is what
makes the server-side tools available at all.

`maxSteps` defaults to **1**. It is set to 10 here — at the default the agent calls
`searchX` and stops before rendering anything.

### Composing the chat instead of embedding it

The UI uses the headless `CopilotChatView` and places its `scrollView` and `input`
slots into the page layout. Two non-obvious props make that work:

- `welcomeScreen={false}` — with zero messages `CopilotChatView` returns its own
  welcome layout _before_ it reads the `children` render prop, silently discarding
  your layout until the first message.
- `input={{ showDisclaimer: false }}` — an object slot merges over the bound props.
  Passing `disclaimer=""` does not work; the input falls back to the default label
  on an empty string.

## Versions

| Package         | Version                        |
| --------------- | ------------------------------ |
| `@copilotkit/*` | 1.67.1 (v2 API, `/v2` subpath) |
| `ai`            | 6.0.253                        |
| `@ai-sdk/xai`   | 3.0.120                        |
| `next`          | 16.3.0                         |

`@ai-sdk/xai@4.x` emits `LanguageModelV4`, which `ai@6.0.253` does not accept — it
wants V2/V3. `3.0.120` pins the same `@ai-sdk/provider@3.0.15` as `ai@6.0.253`.
Don't bump it without checking that pairing.

## Notes

- `lib/discourse.ts` holds a fixture captured from a real X search on 2026-08-12,
  used for offline UI iteration. The live path does not read it.
- Post avatars resolve per handle through `unavatar.io` and fall back to a tinted
  initial. They are derived from the handle, never from model output, so the demo
  cannot invent a face for a real account.
