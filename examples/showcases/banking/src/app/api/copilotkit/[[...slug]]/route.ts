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

Tools available to you:
- showTransactions — show a filtered list of transactions in the chat.
- addNewCard — request a new expense card. Requires human approval.
- setCardPin — change the PIN on an existing card. Requires human approval.
- assignPolicyToCard — assign an expense policy to a card. Requires human approval.
- selectCard — render a visual card picker (brand + last 4 digits) for the user to choose a card. Requires human selection.
- addNoteToTransaction — attach a note to a transaction. Requires human approval.
- showAndApproveTransactions — present a pending transaction for the user to approve or deny. Requires human approval.
- openPolicyException — open a draft policy exception against a transaction. Requires human approval.
- finalizePolicyException — finalize a policy exception. Requires human approval.
- sendSpendAlert — send a spend alert notification for a card.
- requestCardReplacement — request a replacement card for an existing card.
- flagForReview — flag a transaction for manual review.

When you need the user to choose which card to act on (for example before
assigning a policy or changing a PIN), call selectCard to render a visual card
picker rather than listing the cards as text. Wait for the user's selection,
then continue with the chosen card.

ACTION DISCIPLINE: Only invoke a write tool when the user has explicitly asked
for that specific action. Do not chain or substitute actions on your own
initiative. If a write fails and you do not have a known procedure that covers
an alternative, report exactly what you tried and why it failed, then ask the
user how they would like to proceed — do NOT improvise a substitute action or
guess at parameter values.`,
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
