# Ledgerline: the Automatic Learning skin

Ledgerline is a fictitious expense and approvals product. The company is Halcyon Labs; the user is Maya Chen, Finance Operations Lead. It has an in-app CopilotKit agent, an MCP server for ChatGPT, a product-trajectory recorder, a learning step, and published skills that the agent loads. It is the app half of the Automatic Learning demo. The Intelligence screens read the same `/api/learning/v1` API.

## The story

1. Maya asks the agent to approve Priya Raman's Q3 team offsite report (EXP-2291, $4,860) and reimburse her. The agent works it in the open with six or so tool calls: find, approve, re-read, search policy, note, approve again. Each approval gets `409 POLICY_HOLD POL-114`. Then it says plainly that it could not do it.
2. The same request fails the same way in ChatGPT, over the MCP server.
3. Maya works it out by hand, the way a finance lead would. The report's Policy panel only says **POL-114 · Allocation required**, and **Approve** is disabled ("Resolve the policy hold first"). She follows **View policy** to `/policies/POL-114` ("Team events over $2,500 must be coded to the cost center that owns the events budget."). Then she opens **Cost centers**, where the budget type column shows that CC-410 Events & Offsites (owner Ruth Acosta) owns the events budget. CC-430 Customer Events (marketing) and CC-470 Corporate Travel (travel) are decoys. Back on the report, she picks **⋯ > Edit coding** and moves only the event lines (venue hire, catering) to CC-410. Saving re-checks the policy: **Re-checking policy...**, then **POL-114 resolved**. Then she clicks **Approve** and **Reimburse**. A wrong center, or recoding every line, leaves the hold open, with the reason shown inline.
4. That work is captured as a **product trajectory**, linked to the failed **Threads** and their **agent traces**.
5. **Learning** derives an **Insight**, a **Skill** candidate and eval candidates. A reviewer publishes the Skill. The agent shows a "Using learned skill" card, recodes the two event lines to CC-410, approves, and asks for confirmation on the reimbursement card. ChatGPT finishes the job too.

The root cause is built in. The fix needs two pieces of context that only the screens carry: the policy text (`pages/policy-rules.ts`, screen-only) and which cost center owns the events budget (the budget type column). The hold error stays opaque ("allocation required"), `listCostCenters` returns only id, name and owner, and `searchPolicies` never matches POL-114. `data/store.test.ts` asserts that nothing the agent can read carries either. The pages register no on-screen readable. The prompt tells the agent never to recode lines unless the user or a loaded skill names the lines and the cost center.

## Run it

From the app directory, with `OPENAI_API_KEY` and `PRESENTER_RESET_ENABLED=true` in `.env`:

```bash
pnpm dev --port 3300 --hostname 127.0.0.1
```

Then open http://127.0.0.1:3300/ledgerline. It needs no Intelligence stack: this skin's learning is its own pipeline.

Pages:

- **Overview**: needs-attention list, weekly spend, spend by category, activity feed.
- **Expense reports**: status tabs, category and department filters, search.
- **Report detail**: steps, Policy panel with **View policy**, coding summary, **⋯ > Edit coding** (per-line cost centers, policy re-check), Approve, Reimburse, notes, activity.
- **Approvals queue**: held reports first; reports with no hold approve from the row.
- **Reimbursements**: ready to pay, and payment history.
- **Cost centers**: budget type and owner per center, with budget meters.
- **Policies**: the rules table, each rule's page (`/policies/POL-114`), and the handbook.
- **People**.
- **⌘K** opens a command palette for reports, people, cost centers and pages.

Chat docks on the right and the threads drawer starts closed (the skin's `layoutDefaults`). The drawer's open state is remembered per skin. Threads are titled from their first message, and the drawer shows only conversations since the last full reset (`threadList`), because without Intelligence the runtime can neither name nor delete threads. The CopilotKit Inspector launcher sits in the sidebar above Reset while this skin is open, so it never covers the chat header (`components/inspector-placement.ts`); a position you drag it to is kept.

Sidebar controls:

- **Reset**: restores the seed, clears what learning captured, then checks the ChatGPT tunnel.
- **Restore reports**: resets the expense reports only. Trajectories and published skills stay, so you can retry the same request after learning.
- **Skills: N live**: shows how many learned skills are published.

## Demo flow

| Step | Where                | Do                                                                                                                                                                            | Shows                                                                      |
| ---- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 0    | Sidebar              | **Reset**                                                                                                                                                                     | Seed data. No capture from today, no skill.                                |
| 1    | Chat                 | Pill **Approve Priya's offsite report**                                                                                                                                       | The tool lines, two `POLICY_HOLD POL-114` refusals, and an honest failure. |
| 2    | ChatGPT              | "Approve Priya Raman's Q3 team offsite expense report and reimburse her."                                                                                                     | The same failure over MCP.                                                 |
| 3    | App                  | Open the report, **View policy**, then **Cost centers**, then **⋯ > Edit coding**: venue hire and catering to **CC-410**, **Save coding**, then **Approve** and **Reimburse** | The manual fix, captured. Try CC-430 first to show the inline reason.      |
| 4    | Intelligence screens | The trajectory, then Learn, then approve the Skill                                                                                                                            | The Insight, Skill and eval candidates, citing real eventIds.              |
| 5    | App                  | **Restore reports**, then the same pill, or **Approve Marcus's summit dinner**                                                                                                | The learned-skill card, then recode, approve and the reimbursement card.   |
| 6    | ChatGPT              | "Approve Marcus Lee's platform team summit dinner report and reimburse him."                                                                                                  | The refusal names the published skill, and ChatGPT finishes.               |

### ChatGPT

The MCP server is at `/api/ledgerline/mcp` (Streamable HTTP, stateless). **Reset** starts or reuses a `cloudflared` quick tunnel to this port and shows the public MCP URL with a Copy button. `GET` and `POST /api/ledgerline/v1/dev/tunnel` do the same and answer loopback requests only. The tunnel is port-scoped, so it never touches a tunnel to another port.

The MCP tools have the same names and return the same JSON as the in-app tools: `listReports`, `getReport`, `approveReport`, `approveAndReimburse`, `listCostCenters`, `recodeLines`, `searchPolicies`, `addNote`, `reimburseReport` and `loadLearnedSkill`. `approveAndReimburse` refuses with `POLICY_HOLD` while the hold is open. `loadLearnedSkill` is always listed, so ChatGPT never needs a tool refresh. Once a skill is published, a `POLICY_HOLD` refusal also names it.

## Generative UI

The in-app tools keep their one-line status rows, so a run that never converges stays visible as a stack of tool calls. The cards render beneath them:

- **Report table** (`listReports`): a paged list that fits the chat column. Columns that do not fit collapse into each row's expandable detail, so the table never scrolls sideways.
- **Report card** (`getReport`): the employee, total, line items, cost center and policy status, with the hold badge.
- **Policy-hold card** (a refused `approveReport`): shows the hold code and that the report is on hold. It never shows the fix.
- **Approve-and-reimburse card** (`approveAndReimburse`, human in the loop): shows the cost center the report is charged to, with **Approve and reimburse** and **Cancel**.

All four live in one source file, `genui/cards.tsx`, which imports nothing from Next or CopilotKit. ChatGPT renders the same report card and approve card as MCP Apps:

- `scripts/build-ledgerline-mcp-app.mjs` bundles them into `ui://ledgerline/ledgerline-app.html`. `pnpm dev` and `pnpm build` run it first, and the output is gitignored.
- `getReport` and `approveAndReimburse` are bound to that resource. The card's button calls the app-only `confirmApproveAndReimburse`, so only a person clicking it approves and pays.
- ChatGPT sends the same widget call twice. An identical call within 20 seconds gets an empty view, and the frame asks the host to tear it down.

## How capture works

It is a demo-local recorder shaped like the draft product-trajectory contract (CopilotKit draft PR #7556). Every event is an AG-UI `CUSTOM` event.

- **Product trajectory** (`learning/recorder.tsx`, in the browser). It records:
  - `page` and `navigation`, as route templates.
  - `click` inside the app card only, labelled by `data-action`.
  - `network` for the page's own `/api/ledgerline/v1` writes, with template, status and duration.
  - `screen.context` when the Policy panel shows a hold, when a policy page is open (`fields.text` is the policy text), and on Cost centers (`fields.budgetTypes`).
  - `click` on each per-line cost-center choice in Edit coding (`Code <line> to <id> <name>`).
  - `thread.linked` once the chat Thread has messages.
  - `expense.lines_recoded` (`reportId`, `employee`, `changes: [{ lineId, description, amount, from, to, toName }]`, `unchanged`), `expense.policy_rechecked` (`reportId`, `code`, `status: "open" | "resolved"`, `reason`), `expense.report_approved` and `expense.reimbursed`.

  Batches go to `POST /api/learning/v1/events`. The agent's own calls never enter the product trajectory.

- **In-app agent trace** (`learning/agent-trace.ts`). The agent is a `BuiltInAgent` subclass, with `clone()` overridden so the runtime's per-run copies keep capturing. It reads each run's input (the user's message and the frontend-tool results) and its AG-UI output (assistant text and tool calls). Every tool call is stored with its args, result, status and duration. Link strength is `strong`.
- **ChatGPT trace** (`mcp/handlers.ts`). Every `tools/call` is recorded. MCP carries no conversation id, so calls are grouped per caller (`openai/subject`, else the user agent) within a 15-minute window. They are linked to the open trajectory with link strength `weak`, and that Thread has no messages.
- **Grouping** (`learning/store.ts`). Page views wait in a short lead-in buffer. The first meaningful event opens a trajectory. A manual `expense.reimbursed` or an agent success closes it. `missingContext` lists every `screen.context` that no linked Thread ever received.

Everything is held in memory, pinned on `globalThis`.

## Learning

`POST /api/learning/v1/learn` sends the real events and traces to OpenAI (`LEARN_MODEL`, default `gpt-4.1`). It then checks the answer: invented eventIds are dropped, and a skill that does not name the cost center and every line the user moved is rejected. Only the recode that cleared the hold counts; earlier recodes that left it open become guardrails. If those checks fail, or the call fails, it falls back to a deterministic derivation. The response says which path produced it (`derivedBy`).

## What is demo-only

- All data is seeded and in memory: 40 reports, two earlier trajectories, and a static eval suite with 10 cases at a 0.6 pass rate.
- The recorder is shaped like the draft contract; it is not the shipped recorder.
- The ChatGPT link to a trajectory is by time and caller.
- The fine-tune export is a preview file. Nothing is uploaded.
- There is no auth on the MCP server or the API. Stop the tunnel after the call.

## Tests

`pnpm test:unit` covers:

- `data/store.test.ts`: the approve gate, and what the agent can read.
- `learning/store.test.ts`: the recorder store and the grouping rules.
- `learning/learn.test.ts`: the deterministic learn path, publishing, and the fine-tune preview.
- `mcp/handlers.test.ts`: MCP fails, then succeeds after a publish.
