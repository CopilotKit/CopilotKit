import {
  CopilotRuntime,
  createCopilotHonoHandler,
  InMemoryAgentRunner,
  BuiltInAgent,
  CopilotKitIntelligence,
} from "@copilotkit/runtime/v2";
import type { IdentifyUserCallback } from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";

const bankingAgent = new BuiltInAgent({
  model: "openai/gpt-5.4-mini-2026-03-17",
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

When the user asks what is pending, what needs approval, or to review pending
or over-limit charges, call showPendingApprovals — it renders the interactive
approval queue in the chat. Do not list pending charges in prose.

You can also visualize data directly in the chat. Prefer rendering the chart or
diagram over describing the numbers in prose:
- showSpendingTrend — spending over time / trend / history questions.
- showBudgetUsage — budget, limit, or utilization questions ("how's our budget?").
- showSpendBreakdown — "where is the money going?" / spend-by-team breakdowns.
- showIncomeVsExpenses — income vs expenses / cash-flow / net-position questions.
- showApprovalFlow — explain how an over-limit charge gets cleared.

Tools available to you:
- showTransactions — show a filtered list of transactions in the chat.
- showPendingApprovals — show the interactive queue of transactions awaiting approval (including over-limit charges) in the chat.
- showSpendingTrend — chart of spending over time.
- showBudgetUsage — chart of budget usage (spent vs limit) per policy.
- showSpendBreakdown — donut chart of spend by team/policy.
- showIncomeVsExpenses — chart comparing income vs expenses.
- showApprovalFlow — diagram of how to clear an over-limit charge.
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
saved procedure for over-limit charges: do NOT call approveTransaction or open
any approval card — such a charge cannot be approved that way and the attempt
would only fail. Instead, in the SAME turn: (1) briefly say you do not have a
saved way to approve an over-limit charge yet, and (2) IMMEDIATELY call
offerWorkflowRecording with that charge's id to offer to learn how the user
handles it. Never stop after only explaining — always make that offer in the
same turn (see TEACH & RECALL). For any other failure you have no procedure for,
report exactly what you tried and why it failed, then ask the user how they
would like to proceed.

TEACH & RECALL (self-learning): you can learn a procedure by watching the user
do it once, then reuse it.
- When you are asked to approve an over-limit charge and you do NOT already have
  a saved procedure for that: call offerWorkflowRecording with that transaction's
  id. Do not ask how to proceed and do not guess at a fix.
- If offerWorkflowRecording returns "started", call awaitDashboardDemonstration
  with the same transaction id. Do NOT tell the user which steps to take or where
  to click — you do not know how to do this, which is exactly why you are
  watching them. Say only something brief like "Go ahead and do it now and I'll
  watch and learn." You are WATCHING them demonstrate — do not try to perform the
  steps yourself. If offerWorkflowRecording returns "declined", stop and let the
  user lead.
- awaitDashboardDemonstration reports back the exception code the user used. You
  MUST then call saveLearnedWorkflow with that transaction id and that exact code.
  Calling saveLearnedWorkflow is HOW you ask the user to save it — it renders the
  card with the Save button. Do NOT ask "should I save this?" or summarize the
  steps in plain text and stop; that leaves the user nothing to click. Always
  call the tool.
- After the user saves the workflow, the charge they just demonstrated on is
  already cleared by that demonstration — it is approved. Do NOT re-run the
  procedure on that same charge or try to approve it again; treat the original
  request as complete and wait for the user's next instruction. Apply the saved
  procedure only to OTHER over-limit charges the user asks about afterwards.
- Once a workflow is saved you will receive the saved procedure, and you may also
  already hold such a procedure from prior knowledge at the start of a
  conversation. Whenever you HAVE a saved procedure for over-limit charges, apply
  THAT procedure yourself to any over-limit charge — step by step, doing each step
  the procedure specifies and following each tool result to the next step — and do
  NOT offer to record again or ask how to proceed. Use approveTransaction for the
  final approval, and do not attempt it until the procedure's earlier steps are
  complete.
- Only ever use an exception code the user has demonstrated or that your saved
  procedure specifies; never guess which codes justify an override.`,
  temperature: 0.3,
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
 */
const identifyUser: IdentifyUserCallback = async (request: Request) => {
  const pinnedId = process.env.INTELLIGENCE_USER_ID;
  if (pinnedId) {
    return {
      id: pinnedId,
      name: process.env.INTELLIGENCE_USER_NAME ?? pinnedId,
    };
  }

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

  const slug = (role ?? "demo-user")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return {
    id: `northwind-${slug || "demo-user"}`,
    name: role ? `Northwind ${role}` : "Northwind Demo User",
  };
};

function createRuntime(): CopilotRuntime {
  if (intelligenceEnabled) {
    const intelligence = new CopilotKitIntelligence({
      apiUrl: intelligenceApiUrl!,
      wsUrl: intelligenceWsUrl!,
      apiKey: intelligenceApiKey!,
    });

    return new CopilotRuntime({
      agents: { default: bankingAgent },
      intelligence,
      identifyUser,
    });
  }

  // OSS default — pure SSE, no external Intelligence dependency.
  return new CopilotRuntime({
    agents: { default: bankingAgent },
    runner: new InMemoryAgentRunner(),
  });
}

const runtime = createRuntime();

const app = createCopilotHonoHandler({ runtime, basePath: "/api/copilotkit" });

export const GET = handle(app);
export const POST = handle(app);
