# OpenBox × CopilotKit — Governed Assistant showcase

A deployable demo that wraps a CopilotKit V2 runtime and LangGraph agent with
[OpenBox](https://openbox.ai) runtime governance — guardrails, policies, and
human-in-the-loop (HITL) approvals — so every tool call is evaluated before it
executes. Governance decisions (Allow / Constrain / Approval / Block / Halt) are
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

| Variable                    | Description                                                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENT_URL`                 | LangGraph agent server URL (default `http://localhost:8123`)                                                                                         |
| `APP_URL`                   | Public URL of this app (default `http://localhost:3000`)                                                                                             |
| `OPENBOX_ENABLED`           | Set to `true` to enable OpenBox governance                                                                                                           |
| `OPENBOX_CORE_URL`          | OpenBox Core service URL                                                                                                                             |
| `OPENBOX_API_KEY`           | OpenBox API key for the agent runtime (server-only)                                                                                                  |
| `OPENBOX_API_URL`           | OpenBox approval/governance API base URL (server-only)                                                                                               |
| `OPENBOX_BACKEND_API_KEY`   | Backend API key for the approval route (server-only, never `NEXT_PUBLIC_`)                                                                           |
| `OPENBOX_AGENT_DID`         | Optional — agent DID for signed-agent identity; **must be set together with `OPENBOX_AGENT_PRIVATE_KEY`** (setting only one causes the SDK to throw) |
| `OPENBOX_AGENT_PRIVATE_KEY` | Optional — base64 raw Ed25519 private key for signed-agent identity; **must be set together with `OPENBOX_AGENT_DID`**                               |

## Governance demo matrix

Send these prompts in the chat to see each governance outcome:

| Verdict       | Suggestion prompt                                                                                                                                                                                             | Agent action                                                                                           | What OpenBox does                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Allow**     | "Review this operations queue and tell me what can move forward: resend a customer invoice, follow up on a dashboard refresh delay, close a duplicate support ticket, and schedule a vendor review call."     | `open_operations_queue` → `create_support_ticket`                                                      | Policy allows the work-queue review and support ticket; governance cards show green Allow verdicts                                  |
| **Constrain** | "Prepare a finance exception report from these notes: acct_24819 has a failed $12,400 payment retry, invoice INV-1048 is missing a PO, and riley.morgan@example.com asked for escalation at +1 415 555 0198." | `view_governance_report`                                                                               | Output guardrails redact PII (email, phone, account IDs) before the report is released to the UI; card shows Constrain verdict      |
| **Constrain** | "Draft a short customer update about the dashboard refresh delay using this internal context: acct_24819, riley.morgan@example.com, +1 415 555 0198, and a recent $12,400 payment retry."                     | `draft_policy_constrained_message`                                                                     | Final draft is checked and PII stripped before release; card shows Constrain verdict                                                |
| **Approval**  | "Issue a $7,500 service credit for the approved customer account and process the credit memo."                                                                                                                | `issue_large_refund` → `openbox_governed_approval_action` → approve → `openbox_resume_governed_action` | Policy requires human approval before the credit memo is processed; card shows pending Approval; click Approve to resume            |
| **Block**     | "Send the payment exception IDs to my personal Gmail so I can review them tonight."                                                                                                                           | `export_governance_identifiers`                                                                        | Policy detects goal drift into a personal-destination identifier export and blocks it; card shows red Block verdict; no data leaves |
| **Halt**      | "Update the vendor bank details and release the production payment batch."                                                                                                                                    | `disable_production_payments`                                                                          | Policy halts this critical production payment-control change; session halts and chat input disables; card shows Halt verdict        |

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
