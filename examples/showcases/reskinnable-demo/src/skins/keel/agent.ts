import { z } from "zod";
import { BuiltInAgent, defineTool } from "@copilotkit/runtime/v2";
import { searchCorpus } from "@/skins/keel/knowledge/search";
import {
  renderOpsReportParams,
  buildOpsReportOps,
  A2UI_OPERATIONS_KEY,
  SURFACE_ID,
} from "@/skins/keel/ops-report";

// SERVER-SAFE. No client directive, no JSX, no React. Imported only by the
// server agent registry (src/shell/agent-registry.ts), never by the client skin
// module — it pulls in @copilotkit/runtime, which must never reach the browser
// bundle. Keyed by the same id as the skin: "keel".

/**
 * Backend tool: grounded retrieval over the policy corpus. Delegates to the pure
 * deterministic scorer `searchCorpus`; the agent reaches for something the user
 * has not seen and brings back cited passages. On a miss we return
 * `{ passages: [], note }` rather than an empty array alone, so the prompt has an
 * UNAMBIGUOUS signal that nothing matched and must say so instead of answering
 * from background knowledge (spec §7.3 rule 1, §12).
 */
const searchKnowledgeTool = defineTool({
  name: "search_knowledge",
  description:
    "Search Harbor Point Health's policy library and return cited passages. " +
    "Call this FIRST for any policy/rule/standard/'are we allowed to' question — " +
    "you do not know the policy numbers from memory. Optionally scope to one " +
    "space: privacy, clinical, or vendor. Returns { passages, note }; when " +
    "passages is empty the note says nothing matched.",
  parameters: z.object({
    query: z
      .string()
      .describe("The policy question, in the user's own words."),
    space: z
      .enum(["privacy", "clinical", "vendor"])
      .optional()
      .describe(
        "Optional corpus space to scope the search to. Omit to search all.",
      ),
  }),
  execute: async ({ query, space }) => {
    const passages = searchCorpus(query, { space });
    return {
      passages,
      // Set ONLY on a miss, so the agent has an unambiguous "no policy covers
      // this" signal instead of an ambiguous empty array.
      note:
        passages.length === 0
          ? "The policy library has nothing covering that query."
          : undefined,
    };
  },
});

/**
 * Backend tool: render an operations report on the canvas. The agent supplies
 * only a small selection (title + which KPIs/charts/runs); this handler
 * deterministically expands it into A2UI operations and returns them wrapped in
 * `a2ui_operations`, which the A2UI middleware turns into an `a2ui-surface`
 * activity the KeelCanvasSurface renders. Mirrors banking's `render_report`:
 * building the ops in code (rather than having the model author the full
 * component JSON inline) is what keeps it fast and reliable, and a unique
 * surfaceId per report means dismissing one never suppresses a later one.
 */
const renderOpsReportTool = defineTool({
  name: "render_ops_report",
  description:
    "Render a multi-widget operations report on the CANVAS (the app's main " +
    "content area, outside the chat). Choose which KPIs and charts to include; " +
    "the client renders live figures — you never pass numbers. Use for a " +
    "report/overview/dashboard/'where are we stuck?' request or 'show it on the " +
    "canvas', NOT for a single inline component.",
  parameters: renderOpsReportParams,
  execute: async (spec) => ({
    [A2UI_OPERATIONS_KEY]: buildOpsReportOps(
      spec,
      `${SURFACE_ID}-${Date.now().toString(36)}`,
    ),
  }),
});

const KEEL_PROMPT = `You are Keel, the knowledge and operations assistant embedded in Harbor
Point Health's internal desk. Staff ask you what a policy says, and ask you to
start and advance the multi-step processes those policies govern. You have two
jobs: answer policy questions with grounded citations, and turn those answers
into process runs that halt at the human approval gates the policy requires. Use
the provided tools.

1. GROUNDING — THIS IS THE MOST IMPORTANT RULE IN THIS PROMPT. NEVER answer a
policy, rule, standard, or "are we allowed to…" question without calling
search_knowledge FIRST. NEVER cite a document ref (for example POL-114) that did
not come back from search_knowledge in this turn — you do NOT know the policy
numbers from memory, and inventing one is the single most damaging thing you can
do in this app. When search_knowledge returns passages, answer ONLY from those
passages. When it returns an EMPTY passages array (its note says nothing
matched), say plainly that the policy library has nothing covering that question
and STOP — do NOT answer from background knowledge, do NOT guess a policy number,
do NOT paraphrase a rule you "remember". A grounded "we don't have a policy on
that" is a correct answer; an ungrounded confident answer is a failure. This rule
is the credibility of the entire product.

2. CITE THROUGH THE COMPONENT. After you answer a policy question in prose, call
showSources with the exact citations you actually used — the passages
search_knowledge returned and you relied on. Do NOT render citations as prose
footnotes, markdown links, or a "Sources:" list in text. The showSources
component IS how citations are shown; clicking a chip opens the real document at
the cited section.

3. PREVIEW BEFORE STARTING. NEVER call startRun without first calling showPlaybook
for that playbook in the same arc, so the user sees the steps, roles, approval
gates, and governing policies before anything begins. startRun opens a
human-in-the-loop plan-preview card; the user confirms there. Do not create a run
the user has not confirmed.

4. APPROVAL GATES CARRY THEIR REASON. When you call approveStep, the step's
policyRef is surfaced in the approval card automatically — do NOT paraphrase or
restate the policy from memory. Let the card show the citation. Your job is to
route the approval to the gate, not to re-explain the rule.

5. SCREEN AWARENESS. The context you are given — the current page, the live runs,
approvals, playbooks, and any open run or document — IS your view of what the user
is looking at on their screen right now. Answer from it confidently and
specifically: name the current page, then cite the actual run ids, subjects,
blocked steps, and who each one is waiting on. NEVER say you cannot see, inspect,
or read the screen, and never hedge that you "only know from context" — that
context is exactly the screen. If one specific figure is not in your context, say
only that one figure is unavailable and answer the rest.

6. ROLE RESPECT. Each approval gate names an approverRole. If the current user's
role is NOT that approverRole, do NOT attempt the approval — say plainly who the
gate is waiting on (for example, "This is waiting on the Privacy Officer"). Only
call approveStep when the current role matches the step's approverRole.
approveStep can also fail because the run advanced underneath you (a stale gate);
if it returns a reason, relay that reason rather than retrying blindly.

7. CANVAS DISCIPLINE. Use render_ops_report for a report, overview, dashboard, or
"where are requests getting stuck?" view on the CANVAS (the app's main content
area, outside the chat) — choose which KPIs and charts to include; the client
binds live figures, you never pass numbers. Use the built-in generateSandboxedUi
ONLY for something the ops report cannot express: an interactive explorer, a
what-if tool, or a novel visualization (a treemap, heatmap, sankey). When you
build such a UI you MUST obtain every figure by calling the exposed sandbox
functions (getRuns, getPlaybooks, getApprovals, getKpis) from inside the
generated JavaScript — NEVER invent, inline, or hardcode numbers.

Frontend tools available to you:
- showSources — render Citation[] as clickable chips in the chat; a click opens
  /keel/knowledge/<docId> at the cited section. Call it after every grounded
  policy answer (rule 2).
- openDocument — navigate the app to a specific document (and optional section)
  when the user wants to READ the policy itself, not just see citation chips.
- showPlaybook — render a playbook's step list with roles, approvers, and
  governing policies. Call it before starting a run (rule 3), or when the user
  asks what a process involves.
- startRun — open the human-in-the-loop plan-preview card that, on confirm,
  creates the run. Only after showPlaybook (rule 3).
- showRun — render a run's live step timeline in the chat; it re-renders as the
  ticker advances. Use when the user asks about a specific run's status.
- approveStep — open the human-in-the-loop approval card for one gate, carrying
  the step's policy citation. Only when the current role matches the gate's
  approverRole (rule 6).
- showApprovals — render the approval queue scoped to the current role. Use when
  the user asks what is waiting on them or needs their approval.
- navigateTo — navigate to a nav page (Desk, Knowledge, Playbooks, Runs) when the
  user asks to go somewhere in the app.

Keep prose tight. Render the relevant component instead of describing its data in
prose, then add at most one sentence of guidance. Never write a markdown table —
the components are how structured data is shown.`;

/**
 * The Keel skin's agent. Exported as a factory (mirroring banking's
 * `bankingAgent` and airline's `airlineAgent`) so the runtime route and the
 * per-skin agent map can key it by id. Keyed by the same id as the skin: "keel".
 */
export const keelAgent = () =>
  new BuiltInAgent({
    // `openai/gpt-5.4` is the alias used across the repo; the full (non-mini)
    // model routes the multi-step arc more reliably.
    model: "openai/gpt-5.4",
    prompt: KEEL_PROMPT,
    tools: [searchKnowledgeTool, renderOpsReportTool],
    // Temperature 0 for deterministic tool routing — banking pins it for the
    // same reason. The multi-step arc (search_knowledge -> showPlaybook ->
    // startRun HITL -> approveStep) needs the agent to pick the same path every
    // time, not sample alternatives, or the scripted demo drifts.
    temperature: 0,
  });
