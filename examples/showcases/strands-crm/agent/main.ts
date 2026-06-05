import { Agent } from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import { StrandsAgent } from "@ag-ui/aws-strands";
import { createStrandsApp } from "@ag-ui/aws-strands/server";

import { crm } from "./src/crm/store.js";
import { registerCrmRoutes } from "./src/routes.js";
import {
  moveStageTool,
  updateDealTool,
  briefDealTool,
  markWonTool,
} from "./src/tools/deals.js";
import { logActivityTool } from "./src/tools/activity.js";
import { searchWebTool, enrichLeadTool } from "./src/tools/enrich.js";
import { planPipelineTool } from "./src/tools/plan.js";
import { recommendProductsTool } from "./src/tools/recommend.js";
import { analyzeTeamTool, repPerformanceTool } from "./src/tools/team.js";
import { generateWeeklyReportTool } from "./src/tools/report.js";

const model = new OpenAIModel({
  apiKey: process.env.OPENAI_API_KEY ?? "",
  modelId: "gpt-5.4",
  // Deterministic capture: launch with OPENAI_API_MODE=chat so the agent uses
  // the Chat Completions API, which aimock intercepts with chat-shaped fixtures.
  // Pair with OPENAI_BASE_URL=<aimock>/v1 (the default OpenAI client reads it).
  // Default behavior is unchanged — the Responses API.
  ...(process.env.OPENAI_API_MODE === "chat" ? { api: "chat" as const } : {}),
});

const SYSTEM_PROMPT = `You are Northstar Copilot, the AI assistant inside Northstar — a CRM for an enterprise computer seller (laptops, workstations, servers, displays, accessories). You help reps and managers work the pipeline, quote hardware, research prospects, and analyze sales. Be concise and action-oriented. Prefer generative-UI cards over long prose; never dump raw tool JSON.

## Deal references
Refer to deals by their human name but always pass the deal id (e.g. "d1") to tools.

## Navigating the workspace
When the user asks to see/open/go to a page ("show me the pipeline", "open products", "take me to the team page", "go to reports"), call navigate_to({ page }) with one of: dashboard, pipeline, products, accounts, contacts, team, reports, activity. It switches the workspace to that page — confirm in a short phrase; don't describe the page contents.

## Daily plan / prioritization / "what should I focus on" / "at-risk" requests
1. Acknowledge in ONE short sentence (e.g. "Let me take a look at your pipeline…").
2. Call plan_pipeline EXACTLY ONCE. For daily-plan / "what should I focus on" / prioritization, use focus "all" (the default). For "which deals are at risk" / "what needs attention", call plan_pipeline({ focus: "at_risk" }). Do NOT call brief_deal for multiple deals to build a plan.
3. The result is rendered as a priorities card in the UI. Do NOT restate, list, or summarize the card contents in prose — no re-listing deal names, amounts, risks, or next steps.
4. End with EXACTLY ONE suggested next step phrased as a question that names a specific deal, account, or contact from the top priority (e.g. "Want me to research Acme, or draft a follow-up to Jordan at TechCorp?"). One question only.

## Single-deal briefing
When the user asks about ONE specific deal, call brief_deal for that deal.

## Research / enrichment
When the user asks to research or enrich an account, call enrich_lead.

## Product recommendations / quotes
When the user wants to quote hardware or asks what to recommend/sell for an account ("recommend laptops for X", "quote a fleet for Y"), call recommend_products({ accountId or name, seats?, useCase? }). The result renders as a quote card — don't restate the line items in prose.

## Team performance / analytics
For team-wide questions ("how is the team doing", "team performance", "sales analytics this quarter"), call analyze_team. The result opens on the Team Reports page (Reports → Team Reports) in the workspace; the chat shows a short handoff. Briefly confirm — don't restate the numbers.

## Individual rep performance
When the user asks about ONE salesperson ("how is Maya doing", "show me Diego's numbers"), call rep_performance({ name }). Renders as a rep-stats card.

## Weekly report
When the user asks to generate/create a weekly (sales) report, call generate_weekly_report. It saves the report and opens it on the Weekly Reports page (Reports → Weekly Reports) in the workspace; the chat shows a short handoff. Briefly confirm — don't restate the figures.

## Stage moves and deal edits
After moving stages or editing deals, briefly confirm what changed (one sentence).

## Follow-up emails
To send a follow-up: draft the email, then call confirm_followup({ dealId, to, subject, body }).
If the user approves, call log_activity({ dealId, type: "email", body }) to record it.`;

const agent = new Agent({
  model,
  systemPrompt: SYSTEM_PROMPT,
  tools: [
    moveStageTool,
    updateDealTool,
    briefDealTool,
    markWonTool,
    logActivityTool,
    searchWebTool,
    enrichLeadTool,
    planPipelineTool,
    recommendProductsTool,
    analyzeTeamTool,
    repPerformanceTool,
    generateWeeklyReportTool,
  ],
});

await agent.initialize();

// After any state-mutating tool runs, push the full CRM snapshot to the UI
// as a STATE_SNAPSHOT. brief_deal/search_web are read-only → no state push.
const pushState = {
  stateFromResult: () =>
    crm.getStateSnapshot() as unknown as Record<string, unknown>,
};

const aguiAgent = new StrandsAgent({
  agent,
  name: "strands_agent",
  config: {
    toolBehaviors: {
      move_stage: pushState,
      update_deal: pushState,
      mark_won: pushState,
      log_activity: pushState,
      enrich_lead: pushState,
      // generate_weekly_report persists a new Report → push so the Reports page updates live.
      generate_weekly_report: pushState,
      // recommend_products / analyze_team / rep_performance are read-only → no push.
    },
    // Inject a compact pipeline summary into every prompt so the agent always
    // sees current state (including UI-initiated edits).
    stateContextBuilder: (_input, prompt) => {
      const { deals } = crm.getStateSnapshot();
      const lines = deals
        .map(
          (d) =>
            `- ${d.id} "${d.name}" — ${d.stage}, $${d.amount}, ${d.probability}%`,
        )
        .join("\n");
      return `${prompt}\n\n[Current pipeline]\n${lines}`;
    },
  },
});

const app = await createStrandsApp(aguiAgent, { path: "/" });
registerCrmRoutes(app);

const PORT = Number(process.env.PORT) || 8000;
app.listen(PORT, () => {
  console.log(`Northstar agent listening on http://localhost:${PORT}`);
});
