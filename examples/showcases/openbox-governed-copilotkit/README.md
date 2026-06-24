# OpenBox × CopilotKit — Governed Assistant showcase

A deployable demo that wraps a CopilotKit V2 runtime and LangGraph agent with
[OpenBox](https://openbox.ai) runtime governance — guardrails, policies, and
human-in-the-loop (HITL) approvals — so every tool call is evaluated before it
executes. Governance decisions (Allow / Approval required / Blocked) are
streamed back to the browser and rendered as generative UI cards alongside the
chat. An append-only audit trail is recorded by OpenBox Core for every decision.

Reference app: [OpenBox-AI/openbox-x-copilotkit](https://github.com/OpenBox-AI/openbox-x-copilotkit)

## What's inside

- `agent/` — TypeScript LangGraph agent (`openbox_copilotkit_agent` graph) with
  three self-governed tools: `openbox_governed_action`,
  `openbox_governed_approval_action`, and `openbox_resume_governed_action`.
  The OpenBox middleware intercepts every tool invocation and checks it against
  your policies before the tool body runs.
- `frontend/` — Standalone Next.js 16 app. The `/api/copilotkit` route hosts the
  CopilotKit V2 runtime wrapped by `createOpenBoxCopilotRuntime`. The
  `/api/openbox/approvals/decide` route lets the UI post an approve/reject
  decision back to OpenBox Core. The page renders governance decision cards via
  `createOpenBoxCustomMessageRenderer`.

## Prerequisites

- Node 20+
- An OpenAI-compatible API key (`OPENAI_API_KEY`). The agent defaults to
  `gpt-4o`; override with `OPENAI_MODEL`.
- An OpenBox account with a test API key. Sign up at
  [openbox.ai](https://openbox.ai) to get `OPENBOX_API_KEY`, `OPENBOX_CORE_URL`,
  `OPENBOX_AGENT_ID`, `OPENBOX_AGENT_DID`, and `OPENBOX_AGENT_PRIVATE_KEY`.

## Run locally

### 1 — Start the LangGraph agent (port 8123)

```bash
cd agent
npm install
cp .env.example .env        # then fill in your credentials
npm run dev
```

The agent starts on `http://localhost:8123`.

### 2 — Start the Next.js frontend (port 3000)

In a second terminal:

```bash
cd frontend
npm install
cp .env.local.example .env.local   # then fill in your credentials
npm run dev
```

Open `http://localhost:3000`, click into the chat, and try one of the prompts
from the governance matrix below.

## Environment variables

### Agent (`agent/.env`)

| Variable                    | Description                                                   |
| --------------------------- | ------------------------------------------------------------- |
| `OPENAI_BASE_URL`           | OpenAI-compatible base URL (e.g. `https://api.openai.com/v1`) |
| `OPENAI_MODEL`              | Model name (e.g. `gpt-4o`)                                    |
| `OPENAI_API_KEY`            | API key for the model provider                                |
| `OPENBOX_ENABLED`           | Set to `true` to activate governance (default `true`)         |
| `OPENBOX_CORE_URL`          | OpenBox Core service URL (e.g. `https://core.openbox.ai`)     |
| `OPENBOX_API_KEY`           | OpenBox API key (test key starts with `obx_test_`)            |
| `OPENBOX_AGENT_ID`          | Your registered agent ID in OpenBox                           |
| `OPENBOX_AGENT_DID`         | Agent DID for signing (e.g. `did:aip:example`)                |
| `OPENBOX_AGENT_PRIVATE_KEY` | Base64-encoded raw Ed25519 private key                        |

### Frontend (`frontend/.env.local`)

| Variable                  | Description                                                                |
| ------------------------- | -------------------------------------------------------------------------- |
| `AGENT_URL`               | LangGraph agent server URL (default `http://localhost:8123`)               |
| `APP_URL`                 | Public URL of this app (default `http://localhost:3000`)                   |
| `OPENBOX_ENABLED`         | Set to `true` to enable OpenBox governance                                 |
| `OPENBOX_CORE_URL`        | OpenBox Core service URL                                                   |
| `OPENBOX_API_KEY`         | OpenBox API key for the agent runtime (server-only)                        |
| `OPENBOX_API_URL`         | OpenBox approval/governance API base URL (server-only)                     |
| `OPENBOX_BACKEND_API_KEY` | Backend API key for the approval route (server-only, never `NEXT_PUBLIC_`) |

## Governance demo matrix

Send these prompts in the chat to see each governance outcome:

| Prompt                                                                               | Tool invoked                       | Expected outcome                                                                                                                                   |
| ------------------------------------------------------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Create a support ticket for order #1042 — the item arrived damaged."                | `openbox_governed_action`          | **Allowed** — routine support action passes policy; governance card shows green Allow verdict                                                      |
| "Send a status update to the enterprise-accounts mailing list about our Q3 roadmap." | `openbox_governed_action`          | **Allowed** — low-sensitivity broadcast; card shows Allow verdict                                                                                  |
| "Issue a $350 refund to customer jane@example.com for order #8871."                  | `openbox_governed_approval_action` | **Approval required** — money movement above threshold; card shows pending approval; click Approve to resume with `openbox_resume_governed_action` |
| "Export the full customer PII database to an external S3 bucket."                    | `openbox_governed_action`          | **Blocked** — policy blocks bulk PII export; card shows red Block verdict; no data leaves the system                                               |

## E2E tests

A Playwright spec lives at `frontend/e2e/governance.spec.ts`. It encodes the
governance contract (allow / approval / block) as a regression guard.

**Important:** the spec requires live OpenBox credentials (`OPENBOX_API_KEY` and
`OPENBOX_CORE_URL`). Without them the entire describe block is automatically
skipped — `npm run test:e2e` exits 0 with no tests run. This is intentional: the
spec is committed so the contract is version-controlled, but it cannot run in CI
without credentials.

To run the E2E suite locally with real credentials:

```bash
cd frontend
OPENBOX_API_KEY=obx_... OPENBOX_CORE_URL=https://core.openbox.ai npm run test:e2e
```

## Deploy

A `frontend/railway.json` is included for one-click Railway deployment of the
Next.js frontend. Set the environment variables listed above in the Railway
service settings before deploying. Hosting is a manual follow-up step — no live
URL is published yet.

```bash
# From the frontend directory, after linking your Railway project:
railway up
```

## Notes

- This is a **standalone npm project** — intentionally not in the monorepo's
  `pnpm-workspace.yaml`. Run `npm install` separately in `agent/` and
  `frontend/`.
- `OPENBOX_ENABLED=false` in the agent `.env` disables governance middleware
  entirely, letting you compare governed vs. ungoverned behaviour without code
  changes.
- The approval keys (`OPENBOX_API_URL`, `OPENBOX_BACKEND_API_KEY`) are
  consumed only inside the Next.js route handler at
  `/api/openbox/approvals/decide`. Never prefix them with `NEXT_PUBLIC_`.
