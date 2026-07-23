import { z } from "zod";
import { tool } from "@strands-agents/sdk";
import type { JSONValue } from "@strands-agents/sdk";
import { crm } from "../crm/store.js";

export const logActivityTool = tool({
  name: "log_activity",
  description:
    "Record an activity (note, email, call, or meeting) against a deal.",
  inputSchema: z.object({
    dealId: z.string(),
    type: z.enum(["note", "email", "call", "meeting"]),
    body: z.string(),
  }),
  callback: ({ dealId, type, body }) =>
    crm.logActivity(dealId, type, body) as unknown as JSONValue,
});
