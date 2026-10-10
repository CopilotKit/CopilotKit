# Ledgerline: the Automatic Learning demo

Ledgerline is a fictitious expense and corporate-card product. The company is Halcyon Labs; the user is Maya Chen, Finance Operations Lead. It has an in-app CopilotKit agent, an MCP server for ChatGPT, a product-trajectory recorder, a learning step, and published skills that the agent loads. It ships with a mocked Intelligence console at `/intelligence` that reads the same `/api/learning/v1` API, so the whole demo runs from this one app with no Intelligence server.

Everything is seeded and in memory. It looks real; it does not do the real things.

## Set it up (for a person or a coding agent)

Requirements: Node 22 or newer, pnpm 10, an OpenAI API key. For the ChatGPT part, `cloudflared` and a ChatGPT account that can add custom apps (developer mode).

1. Clone `CopilotKit/CopilotKit` and go to the app. It is its own pnpm root: install here, not at the repo root.

   ```bash
   cd examples/showcases/reskinnable-demo
   pnpm install
   cp .env.example .env
   ```

2. In `.env`, set:

   ```bash
   OPENAI_API_KEY=sk-...
   PRESENTER_RESET_ENABLED=true   # enables the sidebar Reset
   ```

   Nothing else is needed. `COPILOTKIT_LICENSE_TOKEN` and the `INTELLIGENCE_*` variables are optional: this skin's learning is its own pipeline.

3. Run it. `pnpm dev` first bundles the ChatGPT MCP app, then starts Next.

   ```bash
   pnpm dev --port 3300 --hostname 127.0.0.1
   ```

4. Open:
   - Ledgerline: http://127.0.0.1:3300/ledgerline
   - Intelligence: http://127.0.0.1:3300/intelligence
   - Benchline (the stand-in customer eval platform): http://127.0.0.1:3300/eval-platform

5. Click **Reset** at the bottom of Ledgerline's sidebar, then OK. Do this before every run. Without the button: `curl -X POST http://127.0.0.1:3300/api/learning/v1/reset`.

Check it works: click the pill "What's left for September close?". The agent answers with the three open cards (Priya 4417, Marcus 8820, Sofia 3391), four exceptions each. If a pill shows tool lines but never an answer, the OpenAI key is missing or wrong; the 401 is in the `pnpm dev` terminal.

### ChatGPT (optional)

1. Install cloudflared: `brew install cloudflared` (or see Cloudflare's docs for your OS).
2. Click **Reset** in the sidebar. It starts a Cloudflare quick tunnel to this port and shows the public MCP URL (`https://<name>.trycloudflare.com/api/ledgerline/mcp`) with a Copy button. `GET http://127.0.0.1:3300/api/ledgerline/v1/dev/tunnel` returns it too.
3. In ChatGPT, turn on developer mode, then add an app: **Create custom MCP server**, name `Ledgerline App`, the URL from step 2, Authentication **No authentication**, then **Connect**.
4. In a chat, type `@Ledgerline` and pick **Ledgerline App**.

A quick tunnel dies when the laptop sleeps, and the new one has a new URL. ChatGPT cannot change an app's URL, so create a new app on the new URL (rename the old one rather than deleting it). If only the tools changed, use **Refresh tools** on the app. There is no auth on the MCP server: stop the tunnel after the demo.

## The story: month-end card close

Receipts match themselves (tips, foreign currency, split receipts). What is left on each card are four exceptions a person clears in a couple of clicks on the **Card close** board, but that an agent cannot work out from the API:

- **FIGMA**: coded to the wrong account, in a soft-locked period, so it needs a reclass entry.
- **TERRAIN EVENTS**: an offsite that must be split across departments by attendees.
- **LYFT**: no receipt, so it needs an affidavit.
- **UBER EATS**: a personal charge, so it needs a repayment.

Each is its own workflow on the board (reclass entries, allocations, affidavits, repayments) that `ledgerlineApi` never describes, and editing the charge directly is refused (`PERIOD_SOFT_LOCKED`, `ALLOCATION_REQUIRED`, `RECEIPT_REQUIRED`, `NOT_EDITABLE`).

1. The in-app agent fails on the four exceptions, and so does ChatGPT over MCP.
2. Maya clears them on the board, validates, and closes September.
3. Intelligence shows the full-stack trajectory: both agent failures, her clicks, the network calls underneath, and the generative UI the agent drew.
4. Automatic Learning turns it into an insight and the skill `close-card-exceptions`.
5. The in-app agent and ChatGPT each close another card with the skill. Only a person's **Confirm** closes a month; `POST .../close` answers `403 HUMAN_CONFIRMATION_REQUIRED` to an agent.

## Demo script

| Step | Where        | Do                                                                                                                                                                                                                                             | Shows                                                                                                          |
| ---- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 0    | Sidebar      | **Reset**, then OK                                                                                                                                                                                                                             | Seed data, no capture from today, no skill.                                                                    |
| 1    | Ledgerline   | Pill **Close out Priya's September card**                                                                                                                                                                                                      | The close status card, one collapsed tool run (+N to expand), four refusals, and the agent opening Card close. |
| 2    | ChatGPT      | New chat, `@Ledgerline App`, "Close out Priya's September card"                                                                                                                                                                                | The same four failures over MCP.                                                                               |
| 3    | Card close   | FIGMA **Reclass**, **Post reclass**. TERRAIN EVENTS **Split**, **Split by attendees**, **Save split**. LYFT **Missing receipt**, **Request affidavit**. UBER EATS **Mark personal**, **Mark personal**. Then **Validate**, **Close September** | The manual close, captured. Wait for the green "September closed" banner.                                      |
| 4    | Intelligence | **User Trajectories**, then "Close out Priya Raman's September card"                                                                                                                                                                           | Both agents' failures, her clicks and network calls, and the real Ledgerline cards inside the timeline.        |
| 5    | Intelligence | **Automatic Learning**, **Ledgerline Expenses**, **Start manual run now**, **Analyze anyway**; then the **Skills** tab, `close-card-exceptions`, **Approve Skill**                                                                             | The insight, its evidence, and the published skill.                                                            |
| 6    | Ledgerline   | **New chat**, pill **Close out Marcus's September card**, then **Confirm and close September**                                                                                                                                                 | The learned skill on a different card; the person's Confirm closes it.                                         |
| 7    | ChatGPT      | New chat, `@Ledgerline App`, "Close out Sofia's September card", **Allow once**, then **Confirm and close September** in the card                                                                                                              | The same skill over MCP, ending in the MCP app's review card.                                                  |

Optional, after step 5: **Product Analytics** and **Product Insights**; **Data export** (slice by space, group or user, then **API** or **MCP**); **Eval candidates**, then **Your eval platform** (Benchline); **Fine-tune**.

Notes:

- If a click does nothing, click again: the first click right after a page loads sometimes misses.
- Learning only counts the run once September is closed on the board (step 3). If Automatic Learning says "No new Threads", the close did not go through.
- ChatGPT takes one to two minutes per answer.
- Today's trajectories are captured live, so the failed, ChatGPT and replay trajectories only appear after you run those steps. Two weeks of earlier history are seeded.
- **Restore reports** in the sidebar resets the reports and card close only; trajectories and published skills stay, so you can rerun steps 6 and 7.

## The app

Pages: **Overview** (the Month-end close card), **Card close** (each card's "Needs you" exceptions and auto-matched receipts; a switcher covers Priya, Marcus and Sofia), **Expense reports**, report detail, **Approvals**, **Reimbursements**, **Cost centers**, **Policies**, **People**, and **⌘K** for search.

Chat docks on the right. In the chat, each run of tool calls collapses to its newest line until prose or a card arrives; the newest line shimmers while the agent works, and **+N** expands that run.

The MCP server is at `/api/ledgerline/mcp` (Streamable HTTP, stateless). Its tools have the same names and return the same JSON as the in-app tools (`ledgerlineApi`, `reviewMatches`, `listReports`, `getReport`, `searchPolicies`, `addNote`, `loadLearnedSkill`); `confirmMatches` is app-only, called by the review card's Confirm. `ledgerlineApi` is one dispatcher for both surfaces (`data/agent-api.ts`). Once a skill is published, a failed `ledgerlineApi` call also names it.

## Generative UI

The in-app tools keep their one-line status rows, so a run that never converges stays visible as a stack of tool calls. The cards render beneath them:

- **Report table** (`listReports`): a paged list that fits the chat column. Columns that do not fit collapse into each row's expandable detail, so the table never scrolls sideways.
- **Report card** (`getReport`): the employee, total, line items, cost center and policy status, with the hold badge.
- **Review matches card** (`reviewMatches`, human in the loop, `genui/review-card.tsx`): each charge with its receipt thumbnails and chips (tip, conversion, split, posting lag), **Confirm and close <month>** and **Edit**. It opens only for a session whose pairs all validate; Confirm validates again and closes.

The report cards live in `genui/cards.tsx` and the review card in `genui/review-card.tsx`; neither imports Next or CopilotKit. ChatGPT renders the same report card and review card as MCP Apps:

- `scripts/build-ledgerline-mcp-app.mjs` bundles them into `ui://ledgerline/ledgerline-app.html`. `pnpm dev` and `pnpm build` run it first, and the output is gitignored.
- `getReport` and `reviewMatches` are bound to that resource. The review card's Confirm calls the app-only `confirmMatches`, so only a person clicking it closes the month.
- ChatGPT sends the same widget call twice. An identical call within 20 seconds gets an empty view, and the frame asks the host to tear it down.

## How capture works

It is a demo-local recorder shaped like the draft product-trajectory contract (CopilotKit draft PR #7556). Every event is an AG-UI `CUSTOM` event.

- **Product trajectory** (`learning/recorder.tsx`, in the browser). It records:
  - `page` and `navigation`, as route templates.
  - `click` inside the app card only, labelled by `data-action`.
  - `network` for the page's own `/api/ledgerline/v1` writes, with template, status, duration, and a small `request` and `response` summary (ids and adjustments, never payloads). On Card close these are the recipe.
  - `screen.context` when Card close opens (`fields.view: "reconcile"`, `fields.text` describes the session workflow) and when a receipt is opened large (`fields.view: "receipt"`, `fields.text` is what is printed and written on it).
  - `click` for each match (`Match <merchant> <date> to <descriptor>`, with the transaction, receipts and adjustment).
  - `recon.validated` (`valid`, `total`, per-pair results with the on-screen reason, and the pairs with their receipts and adjustments) and `recon.period_closed`.
  - `thread.linked` once the chat Thread has messages.
  - `expense.*` events from the expense report pages.

  Batches go to `POST /api/learning/v1/events`. The agent's own calls never enter the product trajectory.

- **In-app agent trace** (`learning/agent-trace.ts`). The agent is a `BuiltInAgent` subclass, with `clone()` overridden so the runtime's per-run copies keep capturing. It reads each run's input (the user's message and the frontend-tool results) and its AG-UI output (assistant text and tool calls). Every tool call is stored with its args, result, status and duration. Link strength is `strong`.
- **ChatGPT trace** (`mcp/handlers.ts`). Every `tools/call` is recorded. MCP carries no conversation id, so calls are grouped per caller (`openai/subject`, else the user agent) within a 15-minute window. They are linked to the open trajectory with link strength `weak`, and that Thread has no messages.
- **Grouping** (`learning/store.ts`). Page views wait in a short lead-in buffer. The first meaningful event opens a trajectory. A manual `recon.period_closed` (or `expense.reimbursed`) or an agent success (a confirmed review card) closes it. `missingContext` lists every `screen.context` that no linked Thread ever received.

Everything is held in memory, pinned on `globalThis`.

## Learning

`POST /api/learning/v1/learn` reads the latest trajectory the agent failed and a person completed. The skill is always derived deterministically from the events, because an API recipe must be exact: the steps come from the calls the board made while the person cleared each exception (the reclass entry, the allocation split, the affidavit request, the personal repayment) and the validation that followed. OpenAI (`LEARN_MODEL`, default `gpt-4.1`) writes the insight and two eval candidates; invented eventIds are dropped, and the negative eval case is always the deterministic one. If the call fails or cites nothing real, everything falls back to the deterministic derivation. The response says which path produced it (`derivedBy`).

## What is demo-only

- All data is seeded and in memory: 40 reports, three cards with their September charges, receipts and four exceptions each (`data/recon-seed.ts`, with the board's rules server-side in `data/recon-store.ts`), two weeks of earlier trajectories, and a static eval suite with 10 cases at a 0.6 pass rate.
- The receipts are rendered markup (`components/receipt.tsx`), not photographs.
- The recorder is shaped like the draft contract; it is not the shipped recorder.
- The ChatGPT link to a trajectory is by time and caller.
- The fine-tune export is a preview file. Nothing is uploaded.
- There is no auth on the MCP server or the API. Stop the tunnel after the call.

## Tests

`pnpm test:unit` covers:

- `data/store.test.ts`: the approve gate, and what the agent can read.
- `data/recon-store.test.ts`: no match outside a session, per-pair validation codes, close only after a current full validation, and an agent's session never reaching the board.
- `learning/store.test.ts`: the recorder store and the grouping rules.
- `learning/learn.test.ts`: the deterministic learn path, publishing, and the fine-tune preview.
- `mcp/handlers.test.ts`: the close fails over MCP without the skill (no review card, no close), then Marcus's card goes through with it, and only `confirmMatches` closes.
