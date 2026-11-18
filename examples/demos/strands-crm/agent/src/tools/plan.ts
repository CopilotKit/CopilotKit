import { z } from "zod";
import { tool } from "@strands-agents/sdk";
import type { JSONValue } from "@strands-agents/sdk";
import { crm } from "../crm/store.js";
import { prioritizePipeline } from "../crm/prioritize.js";

export const planPipelineTool = tool({
  name: "plan_pipeline",
  description:
    'Rank the rep\'s OPEN deals by risk, value, and urgency and return the top priorities (default 3), each with a one-line reason and a concrete next step. Call this ONCE for daily-plan / what-should-I-focus-on requests instead of briefing every deal. Pass focus:"at_risk" when the user asks which deals are at risk / need attention.',
  inputSchema: z.object({
    topN: z
      .number()
      .min(1)
      .max(6)
      .optional()
      .describe("How many top deals to return (1–6, default 3)"),
    focus: z
      .enum(["all", "at_risk"])
      .optional()
      .describe(
        '"all" (default) ranks the whole pipeline; "at_risk" returns only deals that need attention (medium/high risk).',
      ),
  }),
  callback: ({ topN, focus }) =>
    prioritizePipeline(
      crm,
      topN ?? 3,
      undefined,
      focus ?? "all",
    ) as unknown as JSONValue,
});
