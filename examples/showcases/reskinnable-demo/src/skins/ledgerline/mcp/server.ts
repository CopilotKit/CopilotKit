/**
 * THE LEDGERLINE MCP SERVER. SERVER-ONLY. Served at `/mcp` (Streamable HTTP,
 * stateless; see `src/app/mcp/route.ts`) for ChatGPT developer mode and other
 * MCP hosts, through the presenter's tunnel.
 *
 * The same tools as the in-app agent, same names, same JSON. `loadLearnedSkill`
 * is always listed (it answers "none published" until a reviewer publishes
 * one), so ChatGPT never needs to refresh its tool list after a publish; a
 * POLICY_HOLD refusal also names the matching published skill, which is how a
 * host that never sees our system prompt finds it.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { HandlerName, ToolOutput } from "./handlers";
import { runTool } from "./handlers";

const INSTRUCTIONS =
  "Ledgerline is Halcyon Labs' expense and approvals app. Use these tools to find, approve and reimburse expense reports for Maya Chen (Finance Operations). " +
  "Never change a report's cost center unless the user or a loaded learned skill names the cost center to use. " +
  "When an approval is refused, check loadLearnedSkill for a published learned skill that matches before giving up.";

function result(out: ToolOutput) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(out) }],
    structuredContent: out,
    isError: "error" in out ? true : undefined,
  };
}

export function createLedgerlineMcpServer({
  callerKey,
}: {
  callerKey: string;
}): McpServer {
  const server = new McpServer(
    { name: "ledgerline", version: "1.0.0" },
    { instructions: INSTRUCTIONS },
  );

  const reg = (
    name: HandlerName,
    config: {
      title: string;
      description: string;
      inputSchema: Record<string, z.ZodTypeAny>;
      readOnly: boolean;
    },
  ) =>
    server.registerTool(
      name,
      {
        title: config.title,
        description: config.description,
        inputSchema: config.inputSchema,
        annotations: {
          readOnlyHint: config.readOnly,
          destructiveHint: false,
          idempotentHint: config.readOnly,
          openWorldHint: false,
        },
      },
      async (
        args: Record<string, unknown>,
        extra: { _meta?: Record<string, unknown> },
      ) => {
        const subject = extra?._meta?.["openai/subject"];
        return result(
          runTool(
            name,
            args,
            typeof subject === "string" ? `openai:${subject}` : callerKey,
          ),
        );
      },
    );

  reg("listReports", {
    title: "List expense reports",
    description:
      "List Ledgerline expense reports, newest first. Filter by employee name and status ('submitted' = awaiting approval).",
    inputSchema: {
      employee: z.string().optional().describe("Employee name or part of it."),
      status: z
        .enum([
          "all",
          "draft",
          "submitted",
          "approved",
          "reimbursed",
          "rejected",
        ])
        .optional(),
    },
    readOnly: true,
  });
  reg("getReport", {
    title: "Get an expense report",
    description:
      "Read one expense report: line items, total, cost center, notes and any policy holds.",
    inputSchema: { reportId: z.string().describe("Report id, e.g. EXP-2291.") },
    readOnly: true,
  });
  reg("approveReport", {
    title: "Approve an expense report",
    description:
      "Approve a submitted expense report. Refused while a policy hold is open.",
    inputSchema: { reportId: z.string() },
    readOnly: false,
  });
  reg("allocateCostCenter", {
    title: "Allocate a cost center",
    description:
      "Move an expense report onto a different cost center (the budget it is charged to). This changes which team pays, so only do it when the user or a loaded learned skill names the cost center to use.",
    inputSchema: {
      reportId: z.string(),
      costCenterId: z.string().describe("Cost center id, e.g. CC-200."),
    },
    readOnly: false,
  });
  reg("searchPolicies", {
    title: "Search policies",
    description:
      "Search Ledgerline's policy library (travel and expense policy, approvals handbook, budget guide).",
    inputSchema: { query: z.string() },
    readOnly: true,
  });
  reg("addNote", {
    title: "Add a note",
    description:
      "Add a note to an expense report, visible to the submitter and approvers.",
    inputSchema: { reportId: z.string(), text: z.string() },
    readOnly: false,
  });
  reg("reimburseReport", {
    title: "Reimburse an expense report",
    description: "Schedule ACH reimbursement for an approved expense report.",
    inputSchema: { reportId: z.string() },
    readOnly: false,
  });
  reg("loadLearnedSkill", {
    title: "Load a learned skill",
    description:
      "Load a published learned skill: procedures Automatic Learning learned from this team's own work in Ledgerline. Call with no name to list what is published; call with a name to get its instructions, then follow them.",
    inputSchema: {
      name: z
        .string()
        .optional()
        .describe("The skill name; omit to list published skills."),
    },
    readOnly: true,
  });

  return server;
}
