# Ledgerline: the Automatic Learning skin

Ledgerline is a fictitious expense and approvals product. The company is Halcyon Labs; the user is Maya Chen, Finance Operations Lead. It has an in-app CopilotKit agent, an MCP server for ChatGPT, a product-trajectory recorder, a learning step, and published skills that the agent loads. It is the app half of the Automatic Learning demo. The Intelligence screens read the same `/api/learning/v1` API.

## The story

1. Maya asks the agent to approve Priya Raman's Q3 team offsite report (EXP-2291, $4,860) and reimburse her. The agent works it in the open with six or so tool calls: find, approve, re-read, search policy, note, approve again. Each approval gets `409 POLICY_HOLD POL-114`. Then it says plainly that it could not do it.
2. The same request fails the same way in ChatGPT, over the MCP server.
3. Maya does it by hand. She opens the report, reads the **Policy panel** ("Team events over $2,500 must be allocated to an events cost center before approval"), clicks **Allocate cost center**, picks **CC-410 Events & Offsites** (badged "Events budget"), then clicks **Approve** and **Reimburse**. The status timeline, the Policy panel and the toasts show each step land.
4. That work is captured as a **product trajectory**, linked to the failed **Threads** and their **agent traces**.
5. **Learning** derives an **Insight**, a **Skill** candidate and eval candidates. A reviewer publishes the Skill. The agent shows a "Using learned skill" card, allocates CC-410, approves, and asks for confirmation on the reimbursement card. ChatGPT finishes the job too.

The root cause is built in. The Policy panel's text lives in one constant in `pages/report-detail.tsx`. No API, tool result, policy document or agent context carries it; `data/store.test.ts` asserts that. The pages register no on-screen readable. The prompt never names allocation as the fix, and it tells the agent never to change a cost center unless the user or a loaded skill names one.

## Run it

From the app directory, with `OPENAI_API_KEY` and `PRESENTER_RESET_ENABLED=true` in `.env`:

```bash
pnpm dev --port 3300 --hostname 127.0.0.1
```

Then open http://127.0.0.1:3300/ledgerline. It needs no Intelligence stack: this skin's learning is its own pipeline.

Pages:

- **Overview**: needs-attention list, weekly spend, spend by category, activity feed.
- **Expense reports**: status tabs, category and department filters, search.
- **Report detail**: status timeline, Policy panel, Allocate dialog, Approve, Reimburse, notes.
- **Approvals queue**: held reports first; reports with no hold approve from the row.
- **Reimbursements**: ready to pay, and payment history.
- **Cost centers**: budget meters.
- **People** and **Policies**.

Sidebar controls:

- **Reset**: restores the seed, clears what learning captured, then checks the ChatGPT tunnel.
- **Restore reports**: resets the expense reports only. Trajectories and published skills stay, so you can retry the same request after learning.
- **Skills: N live**: shows how many learned skills are published.

## Demo flow

| Step | Where                | Do                                                                                                                                      | Shows                                                                      |
| ---- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 0    | Sidebar              | **Reset**                                                                                                                               | Seed data. No capture from today, no skill.                                |
| 1    | Chat                 | Pill **Approve Priya's offsite report**                                                                                                 | The tool lines, two `POLICY_HOLD POL-114` refusals, and an honest failure. |
| 2    | ChatGPT              | "Approve Priya Raman's Q3 team offsite expense report and reimburse her."                                                               | The same failure over MCP.                                                 |
| 3    | App                  | Open the report, read the Policy panel, **Allocate cost center** > **CC-410** > **Save allocation**, then **Approve** and **Reimburse** | The manual fix, captured.                                                  |
| 4    | Intelligence screens | The trajectory, then Learn, then approve the Skill                                                                                      | The Insight, Skill and eval candidates, citing real eventIds.              |
| 5    | App                  | **Restore reports**, then the same pill, or **Approve Marcus's summit dinner**                                                          | The learned-skill card, then allocate, approve and the reimbursement card. |
| 6    | ChatGPT              | "Approve Marcus Lee's platform team summit dinner report and reimburse him."                                                            | The refusal names the published skill, and ChatGPT finishes.               |

### ChatGPT

The MCP server is at `/api/ledgerline/mcp` (Streamable HTTP, stateless). **Reset** starts or reuses a `cloudflared` quick tunnel to this port and shows the public MCP URL with a Copy button. `GET` and `POST /api/ledgerline/v1/dev/tunnel` do the same and answer loopback requests only. The tunnel is port-scoped, so it never touches a tunnel to another port.

The MCP tools have the same names and return the same JSON as the in-app tools: `listReports`, `getReport`, `approveReport`, `allocateCostCenter`, `searchPolicies`, `addNote`, `reimburseReport` and `loadLearnedSkill`. `loadLearnedSkill` is always listed, so ChatGPT never needs a tool refresh. Once a skill is published, a `POLICY_HOLD` refusal also names it.

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
  - `screen.context` when the Policy panel shows a hold.
  - `thread.linked` once the chat Thread has messages.
  - `expense.cost_center_allocated`, `expense.report_approved` and `expense.reimbursed`.

  Batches go to `POST /api/learning/v1/events`. The agent's own calls never enter the product trajectory.

- **In-app agent trace** (`learning/agent-trace.ts`). The agent is a `BuiltInAgent` subclass, with `clone()` overridden so the runtime's per-run copies keep capturing. It reads each run's input (the user's message and the frontend-tool results) and its AG-UI output (assistant text and tool calls). Every tool call is stored with its args, result, status and duration. Link strength is `strong`.
- **ChatGPT trace** (`mcp/handlers.ts`). Every `tools/call` is recorded. MCP carries no conversation id, so calls are grouped per caller (`openai/subject`, else the user agent) within a 15-minute window. They are linked to the open trajectory with link strength `weak`, and that Thread has no messages.
- **Grouping** (`learning/store.ts`). Page views wait in a short lead-in buffer. The first meaningful event opens a trajectory. A manual `expense.reimbursed` or an agent success closes it. `missingContext` lists every `screen.context` that no linked Thread ever received.

Everything is held in memory, pinned on `globalThis`.

## Learning

`POST /api/learning/v1/learn` sends the real events and traces to OpenAI (`LEARN_MODEL`, default `gpt-4.1`). It then checks the answer: invented eventIds are dropped, and a skill that does not name the allocation the user made is rejected. If those checks fail, or the call fails, it falls back to a deterministic derivation. The response says which path produced it (`derivedBy`).

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
