# Northwind Finance — CopilotKit v2 Banking Demo

A customer-ready reference demo showing how to build a SaaS app with an embedded
AI copilot on top of CopilotKit v2. The app — "Northwind Finance" — models a
corporate banking dashboard where role-based users can view transactions,
manage credit cards, and (for admins) manage team members. The copilot is
wired into the same UI: it reads app context, calls typed tools to render
generative UI, and asks the user to approve sensitive actions via
human-in-the-loop.

## Screenshots

|                                                             |                                                |
| ----------------------------------------------------------- | ---------------------------------------------- |
| ![Northwind Finance dashboard](assets/aurora-dashboard.png) | ![Copilot chat panel](assets/copilot-chat.png) |

![Learning mode — the recording vignette pulses while the copilot records a demonstrated officer action](assets/learning-mode-vignette.png)

While the officer demonstrates an action the copilot should learn from
(approving a transaction, filing a policy exception), a soft violet vignette
pulses around the canvas — the visible signal that the action is being
recorded for the self-learning loop.

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
- **Intelligence:** durable long-term memory across three flavours, all via
  `save_memory` / `recall_memory`:
  - **Demonstrated over-limit procedure** — saved as a `project`-scoped,
    `procedural` memory and recalled at the start of any later over-limit
    request. A **brand-new thread — or a different user on the same team** —
    recalls the procedure and completes the approval unaided. This is the
    durable cross-thread + cross-user proof (FOR-149).
  - **General facts / preferences (`user` scope)** — arbitrary personal facts
    persist cross-thread but stay per-person. Try _"remember my favorite food
    is sushi"_, then ask _"what's my favorite food?"_ in a **new** thread and
    the copilot recalls it.
  - **Team-shared facts (`project` scope)** — facts flagged for the whole team
    persist cross-user, so a teammate recalls them in their own threads.
  - **Secrets are never stored.** Passwords, API keys, tokens, and full card or
    SSN numbers are never written to memory.

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

### 3. The cross-thread payoff (FOR-149)

With the stack up and project memory empty:

1. **Thread A — teach.** Ask to approve an over-limit charge. The agent calls
   `recall_memory`, finds nothing, and offers to record. Demonstrate the policy
   exception on the dashboard, then click **Save workflow** — the agent calls
   `save_memory` (`scope:"project"`, `kind:"procedural"`).
2. **Thread B — recall.** Open a **new** thread and ask to approve a _different_
   over-limit charge. The agent calls `recall_memory`, gets the procedure, files
   the exception with the learned code, and approves — **with no recording offer.**
3. **Different persona.** Switch user (sidebar avatar) in a fresh thread and repeat
   — same unaided success, proving `project`-scope cross-user recall.

### 4. The memory-scope isolation demo (two personas)

The team is exactly **Alex Morgan (Admin)** and **Maya Chen (Assistant)**, mapped
1:1 to the seeded `jordan-beamson` / `morgan-fluxx` backend identities. With
`INTELLIGENCE_USER_ID` unpinned, the sidebar user switcher (bottom-left avatar)
selects which identity is live, so scope isolation is visible end-to-end:

1. **Personal fact — save (as Alex).** Ask _"remember my favorite food is
   sushi."_ The copilot confirms it saved (`user` scope).
2. **Personal fact — recall (as Alex, new thread).** Open a **new** thread and
   ask _"what's my favorite food?"_ — the copilot recalls **sushi** (cross-thread,
   same person).
3. **Personal fact — isolated (switch to Maya, fresh thread).** Switch the sidebar
   user to Maya, open a fresh thread, and ask _"what's my favorite food?"_ — the
   copilot **does NOT know it.** `user`-scope memory is per-person.
4. **Team fact — crosses users.** Back as Alex, say _"keep in mind, for the whole
   team: our fiscal year ends in March."_ Switch to Maya and ask _"when does our
   fiscal year end?"_ — the copilot recalls **March.** `project`-scope memory
   crosses users on the same team.

To replay the "fails first" beat, forget the saved procedure between runs
(`DELETE http://localhost:7050/api/memories/:id`, or via the agent's
`forget_memory` tool). Per-run reset for a repeatable public demo is a separate
follow-up (user-scope memory, periodic DB reset, or a dashboard control).

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

### Inspector (dev console)

The demo surfaces CopilotKit's **product web-inspector** — the same dev console
that ships with `@copilotkit/react-core`. It is enabled via `showDevConsole` on
the `<CopilotKitProvider>` (see `src/app/wrapper.tsx`); open it from the
inspector launcher. It shows AG-UI events, the registered agent, and the
frontend tools + capabilities the demo exposes.

Its **Memory** ("Learning") tab lists and recalls durable memory in Intelligence
mode. That requires two things, both already set for this demo: the runtime runs
in Intelligence mode (`INTELLIGENCE_*` set) and the runtime opts in to the
client-facing memory proxy via `exposeMemoryRoutes: true` (see
`src/app/api/copilotkit/[[...slug]]/route.ts`). Memory flows through the product
path — the client memory store → the runtime's `/api/copilotkit/memories`
handler — not any banking-local Next route. In OSS mode (no `INTELLIGENCE_*`) the
Memory tab shows the store as empty/unavailable.

## Architecture at a glance

```
┌─────────────────────────────────────────────────────────────────┐
│ Frontend (Next.js 16, React 19, Tailwind v4)                    │
│  CopilotKitProvider + CopilotPopup  (@copilotkit/react-core/v2) │
│  ├── useAgentContext       → share user / page state with agent │
│  ├── useFrontendTool       → generative UI (showTransactions)   │
│  └── useHumanInTheLoop     → approval flows (addNewCard, …)     │
└─────────────────────────────┬───────────────────────────────────┘
                              │  AG-UI over SSE
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Runtime (Hono, same Next process)                               │
│  src/app/api/copilotkit/[[...slug]]/route.ts                    │
│    BuiltInAgent + CopilotRuntime + createCopilotHonoHandler     │
│    (from @copilotkit/runtime/v2)                                │
│    env-gated: OSS SSE + InMemoryAgentRunner by default;         │
│    CopilotKitIntelligence when INTELLIGENCE_* env is set        │
│    (see "Self-learning backend" below)                          │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Data layer                                                      │
│  src/data/seed.json          → seed cards, team, policies, txns │
│  src/lib/store.ts            → typed, in-memory store (resets)  │
│  src/app/api/v1/*            → REST surface                     │
│                                (cards, transactions,            │
│                                 users, policies)                │
│  src/lib/identity.ts         → Northwind branding strings       │
└─────────────────────────────────────────────────────────────────┘
```

## Key features and where to find them

### App-wide context for the copilot

`src/components/copilot-context.tsx` shares the current user and the current
page with the agent via `useAgentContext`, so the LLM can adapt its responses
to the logged-in role and the route the user is on. The Northwind brand and
assistant greeting are centralized in `src/lib/identity.ts`.

Switch between users from the bottom-left avatar in the sidebar to see how
role (Admin vs Assistant) changes what the copilot will agree to do.

### Generative UI — `showTransactions`

The cards landing page at `src/app/page.tsx` registers
`useFrontendTool({ name: "showTransactions", render })`. When you ask the
copilot something like _"Show me transactions for my card ending 4242"_, the
LLM calls the tool and the rendered list IS the answer — there is no
follow-up paragraph restating the data.

### Human-in-the-loop — `addNewCard` and `navigateToPageAndPerform`

- `useHumanInTheLoop({ name: "addNewCard", render })` in `src/app/page.tsx`
  shows the "add card" confirmation card directly in chat; the user clicks
  Approve / Cancel and the result is sent back to the agent. The team page
  (`src/app/team/page.tsx`) uses the same pattern for removing a member and
  changing a member's role or team (inviting a member is a UI-only dialog
  flow, not an agent tool).
- `useHumanInTheLoop({ name: "navigateToPageAndPerform" })` in
  `src/components/copilot-context.tsx` is the cross-page fallback: if the user
  asks for an operation that lives on another page (e.g. "change my Visa PIN"
  from the team page), the copilot asks for permission to navigate, then
  redirects with an `?operation=…` query param so the destination page can
  open the right dialog.

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
  policies) are thin handlers around the store and are what the UI uses.
- There is no database. State resets on every server restart — this keeps the
  demo deterministic for screenshots, e2e tests, and customer walkthroughs.

## Tests

End-to-end Playwright smoke tests live under `e2e/` and can be run with:

```bash
pnpm --filter demo-saas-copilot test:e2e
```
