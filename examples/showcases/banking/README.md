# Northwind Finance — CopilotKit v2 Banking Demo

A customer-ready reference demo showing how to build a SaaS app with an embedded
AI copilot on top of CopilotKit v2. The app — "Northwind Finance" — models a
corporate banking dashboard where role-based users can view transactions,
manage credit cards, and (for admins) manage team members. The copilot is
wired into the same UI: it reads app context, calls typed tools to render
generative UI, and asks the user to approve sensitive actions via
human-in-the-loop.

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

## Self-learning backend (optional, Phase C)

By default the runtime is pure OSS: a SSE `CopilotRuntime` + `InMemoryAgentRunner`,
with no external dependency. The agent runs locally against OpenAI and nothing
is persisted. **This is the default and requires only `OPENAI_API_KEY`.**

The runtime in `src/app/api/copilotkit/[[...slug]]/route.ts` is **env-gated**:
when the three Intelligence env vars below are all present, it builds the runtime
in Intelligence mode instead (`CopilotKitIntelligence` + `CopilotRuntime({ intelligence, identifyUser })`).
The local `bankingAgent` still executes here, but every AG-UI event of every run
is also streamed over a Phoenix WebSocket to the Intelligence gateway for durable
threads and self-learning ingestion. If any of the three is unset, the demo falls
back to the exact OSS path above.

```bash
# Required for Intelligence mode (all three, or none):
export INTELLIGENCE_API_URL=http://localhost:4201        # platform REST API
export INTELLIGENCE_GATEWAY_WS_URL=ws://localhost:4401    # Phoenix runner/client gateway
export INTELLIGENCE_API_KEY=cpk_...                       # platform API key
# Optional — read automatically by the runtime if present:
export COPILOTKIT_LICENSE_TOKEN=...
# Optional — pin the asserted end-user identity. Use when the backend enforces
# org membership on the user id (e.g. a local Intelligence stack with seeded
# fixture users); otherwise a stable per-role id is derived automatically:
export INTELLIGENCE_USER_ID=morgan-fluxx
export INTELLIGENCE_USER_NAME="David Garcia"
# Model keys the external Intelligence stack needs to run its writer/reader agents:
export OPENAI_API_KEY=...
export ANTHROPIC_API_KEY=...
```

### What the live loop needs (external)

The distillation backend — the `sl-worker`, `app-api`, and `/knowledge`
endpoints that turn recorded actions into learned procedures — is **not in this
repo**. It lives in the separate Intelligence stack (the CopilotKit Intelligence
repo's `./scripts/local-dev.sh`, or a hosted Intelligence deployment). The demo
can only **connect** to it via the env vars above; it cannot run the loop on its
own.

### The 4-step payoff walkthrough

1. **Agent fails.** A fresh agent is asked to approve an over-limit transaction
   and cannot — it has no procedure for unlocking it, so it reports the failure.
2. **Human unlocks it.** An officer opens and finalizes a policy exception via
   the transactions UI (`src/components/policy-exception-modal.tsx`). These
   demonstrated actions are the teaching signal.
3. **`sl-worker` distills.** The external Intelligence stack ingests the run's
   event stream, distills the officer's actions, and writes a procedure to
   `/knowledge`.
4. **Fresh agent succeeds.** A brand-new agent, asked the same over-limit
   request, reads the distilled knowledge back and performs the unlock unaided.

### Known gap: client-side action recording

Steps 2→3 are intended to be reinforced by an explicit client-side recording API
(`useRecordUserActionInCurrentThread` from `@copilotkit/react-core/v2`). **That
hook does not exist in this OSS react-core/v2 build** (verified against the hooks
index), so `src/lib/record-user-action.ts` is a no-op shim and the call sites in
`policy-exception-modal.tsx` / `transactions-list.tsx` record nothing. The
self-learning loop can still ingest the raw run event stream over the gateway,
but explicit "demonstrated action" recording from the browser is blocked until a
react-core build that exports such a hook is available. See the file's header
comment for details.

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
