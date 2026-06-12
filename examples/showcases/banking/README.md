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
