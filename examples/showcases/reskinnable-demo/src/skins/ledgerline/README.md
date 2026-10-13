# Ledgerline: the Automatic Learning skin

Ledgerline is a fictitious expense and corporate-card product. The company is Halcyon Labs; the user is Maya Chen, Finance Operations Lead. It has an in-app CopilotKit agent, an MCP server for ChatGPT, a product-trajectory recorder, a learning step, and published skills that the agent loads. It is the app half of the Automatic Learning demo. The Intelligence screens read the same `/api/learning/v1` API.

## The story: month-end card close

1. Maya asks the agent to **match the 6 unmatched card transactions** on Priya Raman's Visa •• 4417 to their receipts for the September close. The agent works through `ledgerlineApi`, the integration API, in the open: a direct `PATCH /transactions/{id}` is refused ("Matches must be created inside a reconciliation session"); it finds the session endpoints, pairs the charges, and validation comes back **4 of 6** (`UNBALANCED` on the restaurant and the hotel). It stops and says plainly that nothing is ready for review.
2. The same request fails in ChatGPT, over the MCP server. `reviewMatches` refuses to open a review card until every pair validates.
3. Maya does it by hand on **Card close** (reached from the Overview's "Month-end close" card). She drags each receipt from the inbox onto its card charge (or uses a receipt's **Match** menu). The receipts are images the board renders, and what she reads on them is what the agent cannot: "SQ \*BLUEBOTTLE COFFEE SF" is Blue Bottle Coffee; the Nopa slip has a $24.80 tip written in pen; the hotel billed in euros; one United charge is two receipts; a posting date runs a day or two behind. The board adds the tip and the currency conversion to the pair as an adjustment and shows them as chips. **Validate matches** checks the session; a wrong receipt (the August Amazon order with the same total) fails with the reason inline. Then **Close September**.
4. That work is captured as a **product trajectory**, linked to the failed **Threads** and their **agent traces**. The board's own API calls (open a session, one pair per charge with its adjustment, validate, close) are recorded with their route templates and body summaries: they ARE the recipe.
5. **Learning** derives an **Insight**, the **Skill** (`match-card-receipts`: the exact session recipe plus the matching rules the pairs taught) and eval candidates. A reviewer publishes the Skill. Then Maya asks the agent to **match Marcus's unmatched transactions**, a different card with five different charges: the agent loads the skill, prepares all five matches (a tip, a euro airline ticket, a split order), validates them, and hands over the **Review 5 matches** card. Only her **Confirm** validates and closes the month. ChatGPT does the same with the MCP app card.

The root cause is built in. The workflow (a reconciliation session; what goes in a pair; that a tip or a conversion is an `adjustment` and its shape) exists only on the Card close board, and the receipt details that decide a match are on the receipt images. `ledgerlineApi` gets a terse endpoint index and receipts as merchant, date, total and currency only. The agent never closes a period: `POST /reconciliation/sessions/{id}/close` answers `403 HUMAN_CONFIRMATION_REQUIRED` to it.

## Run it

From the app directory, with `OPENAI_API_KEY` and `PRESENTER_RESET_ENABLED=true` in `.env`:

```bash
pnpm dev --port 3300 --hostname 127.0.0.1
```

Then open http://127.0.0.1:3300/ledgerline. It needs no Intelligence stack: this skin's learning is its own pipeline.

Pages:

- **Overview**: the Month-end close card, needs-attention list, weekly spend, spend by category, activity feed.
- **Card close** (`reconciliation`): each card's unmatched charges beside its receipts inbox; drag to match, Validate matches, Close the month. A card switcher covers Priya's and Marcus's cards.
- **Expense reports**: status tabs, category and department filters, search.
- **Report detail**: steps, Policy panel, coding summary, **⋯ > Edit coding**, Approve, Reimburse, notes, activity.
- **Approvals queue**: held reports first; reports with no hold approve from the row.
- **Reimbursements**: ready to pay, and payment history.
- **Cost centers**: budget type and owner per center, with budget meters.
- **Policies**: the rules table, each rule's page (`/policies/POL-114`), and the handbook.
- **People**.
- **⌘K** opens a command palette for reports, people, cost centers and pages.

Chat docks on the right and the threads drawer starts closed (the skin's `layoutDefaults`). The drawer is its own column to the right of the chat: opening it slides the chat and the app left and the app reflows narrower, so nothing covers the conversation. The drawer's open state is remembered per skin. Threads are titled from their first message, and the drawer shows only conversations since the last full reset (`threadList`), because without Intelligence the runtime can neither name nor delete threads. The CopilotKit Inspector launcher sits in the sidebar above Reset while this skin is open, so it never covers the chat header (`components/inspector-placement.ts`); a position you drag it to is kept.

Sidebar controls:

- **Reset**: restores the seed, clears what learning captured, then checks the ChatGPT tunnel.
- **Restore reports**: resets the expense reports and the card close only. Trajectories and published skills stay, so you can retry after learning.
- **Skills: N live**: shows how many learned skills are published.

## Demo flow

| Step | Where                | Do                                                                                                              | Shows                                                                                     |
| ---- | -------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 0    | Sidebar              | **Reset**                                                                                                       | Seed data. No capture from today, no skill.                                               |
| 1    | Chat                 | Pill **Match my 6 unmatched card transactions**                                                                 | Tool lines, `SESSION_REQUIRED`, a 4 of 6 validation, and an honest failure.               |
| 2    | ChatGPT              | "Match the 6 unmatched card transactions on Priya Raman's Visa ending 4417."                                    | The same failure over MCP; no review card opens.                                          |
| 3    | App                  | Overview **Month-end close**, then drag each receipt onto its charge, **Validate matches**, **Close September** | The manual close, captured. Drop the Aug 30 Amazon order first to show the inline reason. |
| 4    | Intelligence screens | The trajectory, then Learn, then approve the Skill                                                              | The Insight, Skill and eval candidates, citing real eventIds.                             |
| 5    | Chat                 | Pill **Match Marcus's unmatched transactions**                                                                  | The learned skill on a different card, then the Review 5 matches card; Confirm closes it. |
| 6    | ChatGPT              | "Match Marcus Lee's unmatched card transactions (Visa ending 8820)."                                            | A refusal names the published skill; the MCP app review card; Confirm closes.             |

The third pill, **What's left for September close?**, answers from `GET /cards` without starting any matching.

### ChatGPT

The MCP server is at `/api/ledgerline/mcp` (Streamable HTTP, stateless). **Reset** starts or reuses a `cloudflared` quick tunnel to this port and shows the public MCP URL with a Copy button. `GET` and `POST /api/ledgerline/v1/dev/tunnel` do the same and answer loopback requests only. The tunnel is port-scoped, so it never touches a tunnel to another port.

The MCP tools have the same names and return the same JSON as the in-app tools: `ledgerlineApi`, `reviewMatches` (MCP app card), `listReports`, `getReport`, `searchPolicies`, `addNote` and `loadLearnedSkill`; `confirmMatches` is app-only, called by the review card's Confirm. `ledgerlineApi` is one dispatcher for both surfaces (`data/agent-api.ts`, index in `data/agent-api-index.ts`). `loadLearnedSkill` is always listed, so ChatGPT never needs a tool refresh. Once a skill is published, a failed `ledgerlineApi` call also names it.

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

`POST /api/learning/v1/learn` reads the latest trajectory the agent failed and a person completed. The skill is always derived deterministically from the events, because an API recipe must be exact: the steps come from the recorded calls, and the matching rules from the pairs the person validated (descriptor examples, posting lag, the gratuity and fx_conversion adjustment shapes with the worked numbers, split receipts, and the stale receipt that failed). OpenAI (`LEARN_MODEL`, default `gpt-4.1`) writes the insight and two eval candidates; invented eventIds are dropped, and the negative eval case is always the deterministic one. If the call fails or cites nothing real, everything falls back to the deterministic derivation. The response says which path produced it (`derivedBy`).

## What is demo-only

- All data is seeded and in memory: 40 reports, two cards with 11 unmatched September charges and 16 receipts (`data/recon-seed.ts`; which receipt settles which charge lives server-side in `data/recon-store.ts`), two earlier trajectories, and a static eval suite with 10 cases at a 0.6 pass rate.
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
