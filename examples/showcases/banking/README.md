# Northwind Finance — CopilotKit v2 Banking Demo

A customer-ready reference demo showing how to build a SaaS app with an embedded
AI copilot on top of CopilotKit v2. The app — "Northwind Finance" — models a
corporate banking dashboard where role-based users can view transactions,
manage credit cards, browse charges, and (for admins) manage team members.

The copilot is wired into the same UI: it reads app context, renders **React
components** rather than walls of text, asks for approval on sensitive actions
via human-in-the-loop, reads uploaded PDFs, and — in Intelligence mode — carries
durable long-term memory that it both applies and extends.

The chat is docked on the **left** as two columns (thread rail + conversation),
deliberately close to ChatGPT's arrangement, with the app's own icon nav rail on
the right.

```
[ threads 200px ][ conversation 480px ][ the banking app ][ nav rail ]
```

## Screenshots

![Northwind Finance — a filed Q2 report rendered as a dashboard: KPI tiles, three charts, and over-limit charges as decision rows](assets/aurora-dashboard.png)

A filed report is a dashboard, not a memo. Every figure is computed from the live
ledger plus any attached invoice, so the agent supplies narrative only.

![The copilot chat panel, docked left, answering with components and a tool-activity line](assets/copilot-chat.png)

The conversation renders components and retuned markdown; each tool call leaves a
muted activity line you can expand to see the real call.

![Learning mode — the recording vignette pulses while the copilot records a demonstrated officer action](assets/learning-mode-vignette.png)

While you demonstrate an action the copilot should learn (filing a policy
exception, approving an over-limit charge), a soft violet vignette pulses around
the canvas and the recording card lists each step as you take it — the visible
signal that the action is being captured for the self-learning loop.

## The demo script

The chat ships a fixed set of eight suggestion pills (`src/app/wrapper.tsx`),
available on every route, ordered as a walkthrough. Everything is clickable —
you can present the whole demo without typing.

| #   | Pill                                  | What it demonstrates                                                                                                                           |
| --- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Show the spending trend               | Generative UI — a chart renders in the chat                                                                                                    |
| 2   | Change my card PIN                    | An interactive **component in the chat**: card picker + four masked digits. The agent never asks for or receives the digits                    |
| 3   | What's on my screen?                  | Screen awareness — every route publishes what it actually renders                                                                              |
| 4   | Show me the 10 most expensive charges | The agent navigates to `/charges` pre-filtered and stack-ranked                                                                                |
| 5   | Prep the Q2 spend report              | **Multimodal** — one click attaches a real PDF invoice; the model reads it and folds its line items into the filed report's figures and charts |
| 6   | Summarize our spend                   | Applies a **remembered preference** unasked (Intelligence mode)                                                                                |
| 7   | I don't recognize the Delta charge    | Executes a **remembered procedure**: flag → alert → note (Intelligence mode)                                                                   |
| 8   | Approve the $15,000 AWS charge        | **Learns a new procedure** by watching you clear an over-limit charge, then applies it on a fresh thread (Intelligence mode)                   |

Beats 6–8 are sequenced on purpose: _already knows a preference_ → _already
knows a procedure_ → _learns a new one_.

> **Presenting tip:** navigate with the icon rail, not by typing a URL. A full
> page load starts a new thread and will discard an in-progress recording;
> in-app navigation is client-side and preserves the conversation.

## Running locally

```bash
export OPENAI_API_KEY=your-key
pnpm install   # from the repo root — this demo is a workspace package
pnpm --filter demo-saas-copilot dev
```

Then open <http://localhost:3000>.

The demo runs against the workspace versions of `@copilotkit/*` (see the root
`pnpm-workspace.yaml`). The seed dataset lives in memory and resets every time
the server restarts.

Beats 1–5 work in this default OSS mode. Beats 6–8 need Intelligence mode below,
because they depend on durable memory.

## Memory & durable self-learning (Intelligence mode)

By default the runtime is pure OSS: an SSE `CopilotRuntime` + `InMemoryAgentRunner`,
with no external dependency. The agent runs locally against OpenAI and nothing is
persisted. **This is the default and requires only `OPENAI_API_KEY`.**

The runtime in `src/app/api/copilotkit/[[...slug]]/route.ts` is **env-gated**: when
the three `INTELLIGENCE_*` vars below are all present it builds the runtime in
Intelligence mode (`CopilotKitIntelligence` + `CopilotRuntime({ intelligence,
identifyUser, licenseToken, … })`). The local `bankingAgent` still executes here,
but it gains durable long-term memory — the `recall_memory` / `save_memory` MCP
tools auto-attach from the memory-enabled Intelligence backend. If any of the three
is unset, the demo falls back to the exact OSS path above.

### What each mode recalls

- **OSS (default):** the teach-a-workflow loop works _within a single
  conversation_. Start a **new** thread and the agent no longer knows the
  procedure; nothing persists across threads or restarts. (Expected — it's the
  signal that durable recall needs Intelligence mode.)
- **Intelligence:** durable long-term memory, all via `save_memory` /
  `recall_memory`:
  - **The demonstrated over-limit procedure** — saved as a `project`-scoped,
    `operational` memory and recalled at the start of any later over-limit
    request. A **brand-new thread — or a different user on the same team** —
    recalls the procedure and completes the approval unaided.
  - **Facts and preferences (`user` scope)** — personal facts persist
    cross-thread but stay per-person.
  - **Team-shared facts (`project` scope)** — facts flagged for the whole team
    persist cross-user, so a teammate recalls them in their own threads.
  - **Secrets are never stored.** Passwords, API keys, tokens, and full card or
    SSN numbers are never written to memory. Card PINs never reach the agent at
    all — they are typed into a component in the chat.

### Seeded memory: what the demo starts out already knowing

`src/lib/intelligence/seed-memories.ts` defines the memory the demo is expected
to hold **before** you say a word, and `POST /api/v1/dev/reset` re-seeds it after
clearing, so the "it already knows this" beats work on a cold reset:

- Two `topical` / `user` preferences (how Alex likes spend summarized, and their
  role) — drives pill 6. The recalled preference is passed into the component as
  props, so memory changes the _structure_ of what renders, not just the wording.
- One `operational` / `project` procedure for suspicious or unrecognized charges
  — drives pill 7.

The over-limit procedure is deliberately **not** seeded: that is what pill 8
teaches live. Seeding it would mean the agent already knew the answer and would
never offer to record, which removes the whole point of the beat.

### 1. Start the memory-enabled stack (one command)

A self-contained Intelligence stack (postgres + pgvector, redis, minio, a TEI
embedder, and the `app-api` + realtime-gateway composite) is vendored as
`docker-compose.yml`:

**Recommended (one command, handles the embedder per-platform):**

```bash
cd examples/showcases/banking
export INTELLIGENCE_REPO=/path/to/Intelligence   # composite image build context + dev-license signer
./run-demo.sh
```

`run-demo.sh` brings up the stack, picks the right embedder for your platform
(native Metal TEI on Apple Silicon, the bundled docker `tei` on amd64/CI), mints
a dev license if `.env` lacks one, then starts the Next.js dev server.

**Manual (if you prefer raw compose):** the bundled `tei` is gated behind the
`cpu-fallback` profile, so a bare `docker compose up` **skips it** (see the Apple
Silicon note below). On amd64/CI, opt it in:

```bash
export INTELLIGENCE_REPO=/path/to/Intelligence
docker compose --profile cpu-fallback up -d --wait   # amd64/CI: bundled docker embedder
pnpm dev
```

Host ports: app-api **7050**, gateway **7053**, postgres 7156, redis 7158, minio
7160/7161, tei 7167. (The deps use a `715x` range so a bare `docker compose up`
coexists with a developer's own Intelligence dev stack on `705x`.) Seeded org
`casa-de-erlang`, key `cpk_sPRVSEED_seed0privat0longtoken00`, users
`jordan-beamson` / `morgan-fluxx`. The team is exactly two members, each mapped
1:1 to a seeded backend identity — **Alex Morgan (Admin) → `jordan-beamson`** and
**Maya Chen (Assistant) → `morgan-fluxx`** (see `src/lib/intelligence/user-id.ts`).
That 1:1 mapping is what makes cross-user memory scope demonstrable through the
sidebar user switcher. `SL_ENABLED=true` + a reachable embedder are
required for the `save_memory`/`recall_memory` MCP tools to attach — both are set
on the `intelligence` service in `docker-compose.yml`.

> **Apple Silicon:** the bundled `tei` image is amd64-only. Under emulation the
> Candle/safetensors backend is unavailable, so TEI falls back to the ONNX/ORT
> backend — which needs `onnx/model.onnx` files that `Qwen3-Embedding-0.6B` does
> not publish (404), so the container **crash-loops**. `run-demo.sh` handles this
> for you (native Metal TEI on `:7067`). To do it manually, run a native TEI on
> the host and point the stack at it (the bundled `tei` is profile-gated, so a
> bare `up` already skips it):
>
> ```bash
> brew install text-embeddings-inference   # one-time
> text-embeddings-router --model-id Qwen/Qwen3-Embedding-0.6B --port 7067 --auto-truncate &
> MEMORY_EMBEDDINGS_URL=http://host.docker.internal:7067 docker compose up -d --wait
> ```
>
> Same TEI version (1.9.3) + model as the docker image → **byte-identical
> embeddings**, and ~20× faster (Metal GPU vs CPU-under-emulation).

### 2. Point the demo at the stack

```bash
cp .env.example .env       # fill OPENAI_API_KEY; run `copilotkit license -n banking-demo`
# .env (key lines):
#   INTELLIGENCE_API_URL=http://localhost:7050
#   INTELLIGENCE_GATEWAY_WS_URL=ws://localhost:7053
#   INTELLIGENCE_API_KEY=cpk_sPRVSEED_seed0privat0longtoken00
#   # INTELLIGENCE_USER_ID  — leave UNPINNED for the interactive demo (see below)
pnpm --filter demo-saas-copilot dev
```

The Next.js app needs only the three `INTELLIGENCE_*` vars (+ identity). The memory
backend flags (`MEMORY_ENABLED`, `SL_ENABLED`, `MEMORY_EMBEDDINGS_URL`,
`MEMORY_EMBEDDING_MODEL`) live on the `intelligence` service in `docker-compose.yml`.

Leave `INTELLIGENCE_USER_ID` **unpinned** for the interactive demo: with it unset,
the sidebar user switcher drives which backend identity (and therefore which memory
scope) is active, so you can walk through cross-user isolation live. It is pinned to
a single identity only for CI/e2e (see `playwright.config.ts`).

### 3. The cross-thread payoff

With the stack up and the over-limit procedure not yet learned:

1. **Thread A — teach.** Click **Approve the $15,000 AWS charge**. The agent
   calls `recall_memory`, finds nothing, and offers to record. Click **Start
   recording**, then demonstrate on the dashboard (Transactions → Pending
   approval → ⋯ → File policy exception → approve the charge); the recording
   card lists each action as you take it. Click **I'm done**, then **Save
   workflow** — the agent calls `save_memory` (`scope:"project"`,
   `kind:"operational"`).
2. **Thread B — recall.** Open a **new** thread and ask to approve a _different_
   over-limit charge. The agent calls `recall_memory`, gets the procedure, files
   the exception with the learned code, and approves — **with no recording offer.**
3. **Different persona.** Switch user (sidebar avatar) in a fresh thread and repeat
   — same unaided success, proving `project`-scope cross-user recall.

### 4. The memory-scope isolation demo (two personas)

The team is exactly **Alex Morgan (Admin)** and **Maya Chen (Assistant)**, mapped
1:1 to the seeded `jordan-beamson` / `morgan-fluxx` backend identities. With
`INTELLIGENCE_USER_ID` unpinned, the sidebar user switcher (bottom-left avatar)
selects which identity is live, so scope isolation is visible end-to-end. Type
these rather than using the pills:

1. **Personal fact — save (as Alex).** _"Remember my favorite food is sushi."_
   The copilot confirms it saved (`user` scope).
2. **Personal fact — recall (as Alex, new thread).** Open a **new** thread and
   ask _"what's my favorite food?"_ — the copilot recalls **sushi** (cross-thread,
   same person).
3. **Personal fact — isolated (switch to Maya, fresh thread).** Switch the sidebar
   user to Maya, open a fresh thread, and ask the same — the copilot **does NOT
   know it.** `user`-scope memory is per-person.
4. **Team fact — crosses users.** Back as Alex, say _"keep in mind, for the whole
   team: our fiscal year ends in March."_ Switch to Maya and ask _"when does our
   fiscal year end?"_ — the copilot recalls **March.** `project`-scope memory
   crosses users on the same team.

### Presenter reset

Set `PRESENTER_RESET_ENABLED=true` to expose a reset control (↺ in the icon rail,
above the Glass Engine toggle) and enable `POST /api/v1/dev/reset`. Both are off
by default, so a public deployment has neither.

Reset restores the seeded transactions **and** rebuilds memory: it clears every
seeded persona plus the default identity, then re-seeds the preferences and the
suspicious-charge procedure — leaving the over-limit procedure unlearned so beat
8 lands. It then navigates to the bare root, so you always start from the same
screen rather than wherever you happened to be.

### Testing

- **Deterministic E2E (CI gate):** `pnpm --filter demo-saas-copilot test:self-learning`
  runs `e2e/memory-learning.spec.ts`. The agent's LLM is served by
  [`@copilotkit/aimock`](https://github.com/CopilotKit/aimock) (fixtured
  `save_memory`/`recall_memory` tool calls) while the **real** local memory backend
  persists + recalls — so the full teach→save→fresh-thread-recall→unlock flow is
  deterministic. It asserts the fresh thread completes the unlock from recalled
  memory and never offers to record.
- **Real-LLM drift smoke (manual, non-gating):**
  `node scripts/memory-drift-smoke.mjs` seeds the procedure via REST, then drives a
  fresh-thread over-limit request against a real OpenAI key and asserts the live
  model still emits `recall_memory` (the autonomous recall-first moment). aimock
  fixtures replay a fixed decision and cannot catch _behavioral drift_ after a
  prompt edit — this can. The save half is HITL-gated (not headless), so verify it
  via the manual walkthrough above + the aimock E2E. Run after editing the prompt or
  teach tools.

### Advanced mode — Glass Engine

Glass Engine is a docked inspector (desktop-only) that exposes the copilot's
internals. It is gated twice:

- **Availability (deployment):** set `GLASS_ENGINE_AVAILABLE=true` to expose the
  rail's telescope toggle. Leave it unset on public deployments — Glass Engine
  is then absent entirely and the `/api/memories*` routes return 404. (FDE/sales/
  conference deployments set it; one image, per-deployment env.)
- **Activation (presenter):** when available, the telescope toggles the pane on/off
  per session (persisted in localStorage), so you can reveal it case-by-case during
  a talk.

Tabs:

- **Timeline** — every AG-UI protocol event of each run, live (works in any mode).
- **Memory** — "Stored memories (N)": a complete enumeration of what is stored,
  read from app-api's `GET /api/memories` and aggregated across the demo's
  identities so nothing is hidden just because it landed in another scope bucket.
  A separate search box below it does top-k semantic recall.
- **Learning** — the over-limit teach→save→recall procedure and live recall
  activity (Intelligence mode only).

In OSS mode (no `INTELLIGENCE_*`) the Memory and Learning tabs show a "Requires
Intelligence mode" hint.

## Architecture at a glance

```
┌─────────────────────────────────────────────────────────────────┐
│ Frontend (Next.js 16, React 19, Tailwind v4)                    │
│  CopilotKitProvider + CopilotSidebar (position="left")          │
│                              (@copilotkit/react-core/v2)        │
│  ├── useAgentContext       → user, page, and ON-SCREEN figures  │
│  ├── useComponent          → generative UI (charts, tables,     │
│  │                           spend summary, approvals queue)    │
│  ├── useFrontendTool        → side-effect tools (showCharges,    │
│  │                           flagForReview, addNote…)           │
│  ├── useHumanInTheLoop     → approvals (exceptions, PIN, cards) │
│  ├── useConfigureSuggestions + a custom suggestionView slot     │
│  │                         → the eight demo pills               │
│  └── renderToolCalls "*"   → ChatGPT-style tool activity lines  │
└─────────────────────────────┬───────────────────────────────────┘
                              │  AG-UI over SSE (OSS) / WS (Intelligence)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Runtime (Hono, same Next process)                               │
│  src/app/api/copilotkit/[[...slug]]/route.ts                    │
│    BuiltInAgent + CopilotRuntime + createCopilotHonoHandler     │
│    (from @copilotkit/runtime/v2)                                │
│    env-gated: OSS SSE + InMemoryAgentRunner by default;         │
│    CopilotKitIntelligence when INTELLIGENCE_* env is set        │
│    + render_report backend tool → A2UI canvas surface           │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Data layer                                                      │
│  src/data/seed.json          → seed cards, team, policies, txns │
│  src/app/charges/charges-data.ts → ~45 seeded charges           │
│  src/lib/store.ts            → typed, in-memory store (resets)  │
│  src/app/api/v1/*            → REST surface (cards, txns,       │
│                                users, policies, reports, reset) │
│  src/lib/intelligence/       → memory read/seed/forget helpers  │
│  src/lib/identity.ts         → Northwind branding strings       │
└─────────────────────────────────────────────────────────────────┘
```

## Key features and where to find them

### App-wide context, and per-page screen awareness

`src/components/copilot-context.tsx` shares the current user, the app's
pages/operations, and the live cards/policies/transactions via `useAgentContext`.

On top of that, **each route publishes what it actually renders** — the Cards
page its card faces (brand, last 4, credit limit, available), `/charges` its
active filters and visible rows, `/dashboard` its KPIs, `/team` its member
cards. That is what makes "What's on my screen?" answer truthfully instead of
describing the underlying data with different labels.

Switch between users from the bottom-left avatar to see how role (Admin vs
Assistant) changes what the copilot will agree to do.

### Components, never walls of text

The agent is instructed never to emit a markdown table; anything
rows-and-columns goes through a component:

- `showTransactions`, `showPendingApprovals` — lists and the interactive
  approvals queue (`useComponent`, so they persist in the transcript)
- `showSpendingTrend`, `showBudgetUsage`, `showSpendBreakdown`,
  `showIncomeVsExpenses` — hand-rolled SVG/CSS charts, no charting dependency
- `showSpendSummary` — `src/components/wow/spend-summary-card.tsx`; the recalled
  preference drives its props
- `showTable` — `src/components/wow/data-table-chat.tsx`, the generic fallback.
  It renders nothing below two rows: a one-row table is narration in table
  clothing, so that is enforced in the component rather than merely requested
- `render_report` (backend tool) — an A2UI surface on the canvas

One colour per team is shared across every chart via `teamColor()` in
`src/components/analytics-charts.tsx`, keyed to the team rather than its index,
so a category looks the same in every chart on the page.

### Human-in-the-loop, and what is deliberately _not_ gated

`useHumanInTheLoop` drives the approvals that move money or change credentials:
`addNewCard`, `openPolicyException`, `finalizePolicyException`,
`approveTransaction`, and the teach-loop cards.

`setCardPin` (in `copilot-context.tsx`) renders
`src/components/wow/pin-change-card.tsx` — a card picker plus four masked,
auto-advancing digit inputs. The agent opens the card but never asks for or sees
the digits, so a PIN never reaches the transcript or the model's context.

Annotations are **not** gated: `addNoteToTransaction` runs immediately. As an
approval card it left an unresolved tool call whenever a presenter moved on
without answering it, and the next message then failed the whole thread with
`Tool result is missing for tool call …`.

Anything a **recalled procedure** can call is registered globally in
`copilot-context.tsx`, not on a route. A saved procedure has no idea which page
the user is on when they invoke it, so a route-scoped tool silently turns a
stored workflow into a one-page workflow.

### Multimodality — the Q2 report

`src/components/chat/attach-invoice.ts` stages the bundled
`public/sample-invoice-q2.pdf` into the composer's attachment queue, so the Q2
pill sends a real PDF attachment (it shows as a chip on the message). The model
reads the invoice and passes its line items to `createReport`'s `additions`,
which `src/components/wow/report-card.tsx` folds into the report's figures and
charts on top of the live ledger.

Filed reports render as a dashboard — KPI tiles, three charts, over-limit
charges as scannable rows — with the agent's narrative capped to one sentence
plus at most three short notes. Every figure is computed from the live ledger, so
the agent supplies narrative only and cannot quote a number the app disagrees
with.

### Role-based behaviour

Authorization is communicated to the agent through `useAgentContext` rather
than enforced on the LLM by prompt alone. The REST handlers in
`src/app/api/v1/*` enforce the same rules on the server side, so a curious
user (or a hallucinating model) cannot bypass them.

## Backend & data

- All read/write goes through `src/lib/store.ts`, which exposes typed helpers
  — readers like `cards()`, `team()`, `policies()`, `transactions()` and
  mutators like `findCard`, `updateCardPin`, `assignPolicyToCard`,
  `updateTransaction` — over an in-memory copy of `src/data/seed.json`.
- The REST endpoints under `src/app/api/v1/*` (cards, transactions, users,
  policies, reports, and the gated `dev/reset`) are thin handlers around the
  store and are what the UI uses.
- There is no database. State resets on every server restart — this keeps the
  demo deterministic for screenshots, e2e tests, and customer walkthroughs.
- Two helper families live in `src/app/actions.ts` and they are **not**
  interchangeable: `openPolicyException`, `finalizePolicyException` and
  `changeTransactionStatus` return `{ ok, data | error }`, while `changePin` and
  `addNoteToTransaction` resolve with the updated record and throw or return
  undefined on failure. Destructuring `ok` off the second family silently
  reports a success as a failure.

## Tests

```bash
pnpm --filter demo-saas-copilot test:unit           # vitest
pnpm --filter demo-saas-copilot test:e2e            # playwright
pnpm --filter demo-saas-copilot test:e2e:ogui       # open generative UI suite
pnpm --filter demo-saas-copilot test:self-learning  # the memory CI gate
```
