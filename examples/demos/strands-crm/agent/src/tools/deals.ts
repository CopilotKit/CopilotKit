import { z } from "zod";
import { tool } from "@strands-agents/sdk";
import type { JSONValue } from "@strands-agents/sdk";
import { crm } from "../crm/store.js";
import { buildDealBrief } from "../crm/brief.js";
import { STAGES } from "../crm/types.js";

export const moveStageTool = tool({
  name: "move_stage",
  description:
    "Move a deal to a different pipeline stage. Use the exact stage name.",
  inputSchema: z.object({
    dealId: z.string().describe("Deal id, e.g. 'd1'"),
    stage: z.enum(STAGES as [string, ...string[]]).describe("Target stage"),
  }),
  callback: ({ dealId, stage }) =>
    crm.moveStage(dealId, stage as never) as unknown as JSONValue,
});

export const updateDealTool = tool({
  name: "update_deal",
  description:
    "Update a deal's amount, probability (0-100), close date (yyyy-mm-dd), or name.",
  inputSchema: z.object({
    dealId: z.string(),
    amount: z.number().optional(),
    probability: z.number().min(0).max(100).optional(),
    closeDate: z.string().optional(),
    name: z.string().optional(),
  }),
  callback: ({ dealId, ...fields }) =>
    crm.updateDeal(dealId, fields) as unknown as JSONValue,
});

export const briefDealTool = tool({
  name: "brief_deal",
  description:
    "Produce a structured briefing for a single deal (stage, amount, key contact, last activity, risk, next step).",
  inputSchema: z.object({ dealId: z.string() }),
  callback: ({ dealId }) => buildDealBrief(crm, dealId) as unknown as JSONValue,
});

export const markWonTool = tool({
  name: "mark_won",
  description: "Mark a deal as Closed Won.",
  inputSchema: z.object({ dealId: z.string() }),
  callback: ({ dealId }) => crm.markWon(dealId) as unknown as JSONValue,
});
