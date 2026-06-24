import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  governAction,
  resumeGovernedAction,
} from "./openbox_action_governance.js";

const governedActionSchema = z.object({
  action: z.string(),
  request: z.string(),
  destination: z.string().optional(),
  amountUsd: z.number().optional(),
  fields: z.array(z.string()).optional(),
  audience: z.string().optional(),
  sensitivity: z.string().optional(),
});

const resumeGovernedActionSchema = governedActionSchema.extend({
  workflowId: z.string(),
  runId: z.string(),
  activityId: z.string(),
  approvalId: z.string().optional(),
  governanceEventId: z.string().optional(),
  approved: z.boolean().optional(),
});

export const openbox_governed_action = tool(
  async (input, config) => {
    const result = await governAction(input, config);
    return JSON.stringify(result);
  },
  {
    name: "openbox_governed_action",
    description:
      "Execute a realistic governed business action for the OpenBox demo.",
    schema: governedActionSchema,
  },
);

export const openbox_governed_approval_action = tool(
  async (input, config) => {
    const result = await governAction(input, config);
    return JSON.stringify(result);
  },
  {
    name: "openbox_governed_approval_action",
    description:
      "Execute a governed business action that may require human approval (money movement, refunds, payouts) for the OpenBox demo.",
    schema: governedActionSchema,
  },
);

export const openbox_resume_governed_action = tool(
  async (input, config) => {
    const result = await resumeGovernedAction(input, config);
    return JSON.stringify(result);
  },
  {
    name: "openbox_resume_governed_action",
    description:
      "Resume a previously approved governed action after an OpenBox approval decision, executing the action only when approved.",
    schema: resumeGovernedActionSchema,
  },
);
