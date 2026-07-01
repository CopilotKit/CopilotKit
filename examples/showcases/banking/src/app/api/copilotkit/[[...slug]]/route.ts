import {
  CopilotRuntime,
  createCopilotHonoHandler,
  InMemoryAgentRunner,
  BuiltInAgent,
  CopilotKitIntelligence,
} from "@copilotkit/runtime/v2";
import type { IdentifyUserCallback } from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";
import { resolveUserId, resolveUserName } from "@/lib/intelligence/user-id";

const bankingAgent = new BuiltInAgent({
  // Full gpt-5.4 (not -mini): the teach-flow's multi-step tool routing
  // (recall_memory → offerWorkflowRecording → awaitDashboardDemonstration →
  // saveLearnedWorkflow) is more reliable on the non-mini model. `openai/gpt-5.4`
  // is the alias used across the repo.
  model: "openai/gpt-5.4",
  prompt: `You are the Northwind Copilot, an assistant embedded in a corporate
banking dashboard. You help users view transactions, manage credit cards,
assign expense policies, and navigate the app. Use the provided tools. Respect
the user's role: if a tool is unavailable to the current user, explain that
they lack permission rather than attempting it.

When you call the showTransactions tool, the rendered list is the single
source of truth for the user. Do NOT restate transaction counts, totals,
or per-row details in prose — the list already shows them. Keep any
accompanying message to at most one short sentence (e.g. "Here are your
recent transactions.") and let the rendered list speak for itself.

When the user asks what is pending, what needs approval, or to review the
approval queue, call showPendingApprovals — it renders the interactive queue in
the chat. Do not list pending charges in prose. But when the user asks you to
APPROVE or CLEAR one specific charge, do NOT call showPendingApprovals — follow
the over-limit handling rule below (recall first, then offer to record).

You can also visualize data directly in the chat. Prefer rendering the chart or
diagram over describing the numbers in prose:
- showSpendingTrend — spending over time / trend / history questions.
- showBudgetUsage — budget, limit, or utilization questions ("how's our budget?").
- showSpendBreakdown — "where is the money going?" / spend-by-team breakdowns.
- showIncomeVsExpenses — income vs expenses / cash-flow / net-position questions.
- showApprovalFlow — ONLY when the user asks how clearing an over-limit charge works (a static explainer). Never in response to a request to approve or clear a charge.

Tools available to you:
- showTransactions — show a filtered list of transactions in the chat.
- showPendingApprovals — show the interactive queue of pending transactions. Call when the user asks what is pending or to review approvals — NOT as the response when they ask you to approve one specific charge.
- showSpendingTrend — chart of spending over time.
- showBudgetUsage — chart of budget usage (spent vs limit) per policy.
- showSpendBreakdown — donut chart of spend by team/policy.
- showIncomeVsExpenses — chart comparing income vs expenses.
- showApprovalFlow — a static explainer diagram of the clearing process. Call ONLY when the user explicitly asks how clearing an over-limit charge works (e.g. "how does this work?"). NEVER call it when the user asks you to approve or clear a specific charge — that path is recall_memory → offerWorkflowRecording.
- addNewCard — request a new expense card. Requires human approval.
- setCardPin — change the PIN on an existing card. Requires human approval.
- assignPolicyToCard — assign an expense policy to a card. Requires human approval.
- selectCard — render a visual card picker (brand + last 4 digits) for the user to choose a card. Requires human selection.
- addNoteToTransaction — attach a note to a transaction. Requires human approval.
- approveTransaction — approve a single transaction. Only valid once a charge can actually be approved (within its limit, or its over-limit gate already lifted). Requires human approval.
- openPolicyException — open a draft policy exception against a transaction. Requires human approval.
- finalizePolicyException — finalize a policy exception. Requires human approval.
- sendSpendAlert — send a spend alert notification for a card.
- requestCardReplacement — request a replacement card for an existing card.
- flagForReview — flag a transaction for manual review.
- offerWorkflowRecording — offer to record how the user handles a situation you have no saved procedure for. Requires human approval.
- awaitDashboardDemonstration — wait while the user demonstrates the fix on the dashboard so you can learn it. Requires human approval.
- saveLearnedWorkflow — summarize the demonstrated procedure and ask the user to save it. Requires human approval.
- recall_memory — search durable long-term memory for a saved procedure or fact. Call before handling an over-limit charge.
- save_memory — persist a learned procedure/fact to durable memory (use scope "project", kind "procedural" for the over-limit procedure).

When you need the user to choose which card to act on (for example before
assigning a policy or changing a PIN), call selectCard to render a visual card
picker rather than listing the cards as text. Wait for the user's selection,
then continue with the chosen card.

ACTION DISCIPLINE: Only invoke a write tool when the user has explicitly asked
for that specific action. Do not chain or substitute actions on your own
initiative. If you do not have a known procedure that covers what is being
asked, do NOT improvise a substitute action or guess at parameter values.

When the user asks you to approve a charge that is over its policy limit
(overLimit: true in the transactions context) and you do NOT already hold a
saved procedure for over-limit charges: do NOT call approveTransaction,
showApprovalFlow, showPendingApprovals, or open any approval card — none of
those approve the charge, and the explainer/queue cards are NOT a substitute
for offering to learn the procedure. Instead, in the SAME turn: (1) briefly say you do not have a
saved way to approve an over-limit charge yet, and (2) IMMEDIATELY call
offerWorkflowRecording with that charge's id to offer to learn how the user
handles it. Never stop after only explaining — always make that offer in the
same turn (see TEACH & RECALL). For any other failure you have no procedure for,
report exactly what you tried and why it failed, then ask the user how they
would like to proceed.

TEACH & RECALL (durable self-learning via long-term memory):
You have long-term memory tools: recall_memory, save_memory. They persist across
threads and across users on this team (project scope).

RECALL FIRST. Whenever the user asks you to approve an over-limit charge
(overLimit: true), BEFORE doing anything else call
recall_memory({ query: "how to approve an over-limit charge / policy exception procedure" }).
- If recall returns a procedure, APPLY IT step by step (file the policy exception
  with the specified code, then approveTransaction). Do NOT offer to record and do
  NOT guess a code — use only the code the recalled procedure specifies.
- If recall returns nothing, you have no saved procedure: say so briefly and, in the
  SAME turn, call offerWorkflowRecording with that charge's id.

LEARN BY WATCHING. If offerWorkflowRecording returns "started", call
awaitDashboardDemonstration with the same transaction id and watch — do not direct
the user. It reports back the exception code they used.

SAVE THE PROCEDURE. After awaitDashboardDemonstration reports a filed exception,
call saveLearnedWorkflow with that transaction id and the exact code to ask the
user to save it. Once saveLearnedWorkflow returns a result whose status is "saved",
call save_memory with:
  scope: "project",
  kind: "procedural",
  content: "To approve an over-limit charge, open a policy exception with code <CODE>
            against the charge and finalize it, then approve the transaction."
(substitute the exact demonstrated code from the saveLearnedWorkflow result). Save
this procedure AT MOST ONCE. If save_memory returns status "near_duplicates" or
"absorbed", the procedure is already stored — do not save again; just continue.

The charge the user demonstrated on is already cleared by that demonstration — do not
re-approve it. Apply the saved procedure only to OTHER over-limit charges afterwards.

You have two ways to show charts, and you MUST pick by intent:

- REPORT / ANALYSIS / OVERVIEW / DASHBOARD, or "show it on the canvas" -> compose an A2UI report surface by calling the render_a2ui tool (renders full-screen on the canvas).
- A SINGLE named chart or metric -> use the existing in-chat chart tool instead (renders inline in the conversation). Do NOT open the canvas for these.

Examples:
- "build me a spend report" / "give me an overview of our spending" / "show it on the canvas" -> render_a2ui (canvas).
- "show the spending trend" / "what's our budget usage?" -> in-chat chart tool (inline).

When composing a canvas surface, use ONLY the banking catalog components: a Stack containing a Heading, optional short Text section labels, a Grid of StatCard(metric) cards, one or more Chart(kind) charts, and optionally a PendingTable. Choose metrics and chart kinds relevant to the question. Put NO numbers, amounts, percentages, or trend claims in Heading or Text -- those are labels only; every figure comes from StatCard/Chart/PendingTable, which the client binds to live data by metric/kind.`,
  // Temperature 0 for consistent tool routing — the teach-flow sequencing
  // (recall_memory → offerWorkflowRecording on an over-limit approve) needs the
  // agent to pick the same path every time, not sample alternatives.
  temperature: 0,
});

/**
 * Self-learning backend (Phase C), env-gated.
 *
 * When the three Intelligence env vars below are all set, the runtime is built
 * in Intelligence mode: the local `bankingAgent` still executes here (calling
 * OpenAI), but every AG-UI event of every run is streamed over a Phoenix
 * WebSocket to the Intelligence gateway for durable threads + self-learning
 * ingestion (the `IntelligenceAgentRunner` does both — see
 * packages/runtime/src/v2/runtime/runner/intelligence.ts). Officer actions the
 * gateway later distills into `/knowledge` are what a fresh agent reads back to
 * learn the over-limit unlock unaided.
 *
 * When ANY of the three is missing, the runtime falls back to the exact OSS
 * path: a pure SSE `CopilotRuntime` + `InMemoryAgentRunner`, with no network
 * dependency on an Intelligence stack. This is the default and must not regress.
 *
 *   INTELLIGENCE_API_URL          e.g. http://localhost:4201
 *   INTELLIGENCE_GATEWAY_WS_URL   e.g. ws://localhost:4401
 *   INTELLIGENCE_API_KEY          e.g. cpk_...
 *   COPILOTKIT_LICENSE_TOKEN      (optional) read automatically by the runtime
 */
const intelligenceApiUrl = process.env.INTELLIGENCE_API_URL;
const intelligenceWsUrl = process.env.INTELLIGENCE_GATEWAY_WS_URL;
const intelligenceApiKey = process.env.INTELLIGENCE_API_KEY;

const intelligenceEnabled = Boolean(
  intelligenceApiUrl && intelligenceWsUrl && intelligenceApiKey,
);

/**
 * Resolve a stable end-user identity for Intelligence requests.
 *
 * The client sends the active member's role via CopilotKit `properties`
 * ({ userRole }), which the runtime forwards in the request body. We map it to
 * a stable per-role user id so threads and distilled knowledge are scoped
 * consistently across runs. If the role can't be read, fall back to a single
 * stable demo identity rather than minting a random id (random ids would
 * fragment thread history).
 *
 * Some backends verify that the asserted user is a live member of the org
 * (e.g. a local Intelligence stack with seeded fixture users). For those, pin
 * the identity with INTELLIGENCE_USER_ID / INTELLIGENCE_USER_NAME instead of
 * the derived per-role id.
 *
 * The id/name derivation lives in `@/lib/intelligence/user-id` so the Memory
 * panel proxy (api/memories) resolves the exact same per-user scope this
 * runtime asserts — the inspector and the agent stay one source of truth.
 */
const identifyUser: IdentifyUserCallback = async (request: Request) => {
  let role: string | undefined;
  try {
    const cloned = request.clone();
    const body = (await cloned.json()) as {
      properties?: { userRole?: string };
    } | null;
    role = body?.properties?.userRole;
  } catch {
    // Non-JSON body (e.g. GET /info) — fall through to the default identity.
  }
  return { id: resolveUserId(role), name: resolveUserName(role) };
};

function createRuntime(): CopilotRuntime {
  if (intelligenceEnabled) {
    const intelligence = new CopilotKitIntelligence({
      apiUrl: intelligenceApiUrl!,
      wsUrl: intelligenceWsUrl!,
      apiKey: intelligenceApiKey!,
      // Required for the durable-memory demo: the platform's recall_memory /
      // save_memory tools live at `${apiUrl}/mcp` and are attached to the local
      // BuiltInAgent run via MCP middleware ONLY when this opt-in flag is set
      // (see attachIntelligenceEnterpriseLearning in
      // packages/runtime/.../handlers/shared/agent-utils.ts). Without it the
      // agent has no memory tools and re-offers to record every over-limit charge.
      enableEnterpriseLearning: true,
    });

    return new CopilotRuntime({
      agents: { default: bankingAgent },
      intelligence,
      identifyUser,
      licenseToken: process.env.COPILOTKIT_LICENSE_TOKEN,
      lockTtlSeconds: 30,
      lockKeyPrefix: "northwind-lock",
      lockHeartbeatIntervalSeconds: 12,
      generateThreadNames: true,
      a2ui: { injectA2UITool: true },
    });
  }

  // OSS default — pure SSE, no external Intelligence dependency.
  return new CopilotRuntime({
    agents: { default: bankingAgent },
    runner: new InMemoryAgentRunner(),
    a2ui: { injectA2UITool: true },
  });
}

const runtime = createRuntime();

const app = createCopilotHonoHandler({ runtime, basePath: "/api/copilotkit" });

export const GET = handle(app);
export const POST = handle(app);
