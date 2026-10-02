/**
 * THE LEDGERLINE MCP SERVER. SERVER-ONLY. Served at `/api/ledgerline/mcp`
 * (Streamable HTTP, stateless) for ChatGPT developer mode and other MCP hosts,
 * through the presenter's tunnel.
 *
 * MCP APPS. `getReport` and `reviewMatches` are bound to one UI resource,
 * `ui://ledgerline/ledgerline-app.html`: the SAME report card and review card
 * the in-app chat renders (`genui/cards.tsx`), bundled by
 * `scripts/build-ledgerline-mcp-app.mjs`. The write is app-only
 * (`confirmMatches`): the model opens the card, and only a person
 * clicking Confirm in it closes the month. `registerAppTool` writes both the current
 * `_meta.ui.resourceUri` and the legacy key, so one registration serves every
 * host. ChatGPT issues the same widget-bound call twice for one prompt; with
 * `collapseRepeats` an identical call within 20 seconds gets an empty view.
 *
 * The same tools as the in-app agent, same names, same JSON. `loadLearnedSkill`
 * is always listed (it answers "none published" until a reviewer publishes
 * one), so ChatGPT never needs to refresh its tool list after a publish; a
 * POLICY_HOLD refusal also names the matching published skill, which is how a
 * host that never sees our system prompt finds it.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import type { HandlerName, ToolOutput } from "./handlers";
import { runTool } from "./handlers";
import { LEDGERLINE_API_DESCRIPTION } from "../data/agent-api-index";

const INSTRUCTIONS =
  "Ledgerline is Halcyon Labs' expense and card app. Help Maya Chen (Finance Operations) with expense reports and the month-end card close. " +
  "Before a task, check loadLearnedSkill for a published learned skill that matches it and follow it. Otherwise use ledgerlineApi; if you cannot finish after about six attempts, say plainly what failed. " +
  "You never close a period yourself: reviewMatches hands the matches to the user, and only their Confirm in the card closes it.";

export const LEDGERLINE_APP_URI = "ui://ledgerline/ledgerline-app.html";

/** Written by `scripts/build-ledgerline-mcp-app.mjs`; read per request. */
export const LEDGERLINE_APP_HTML_PATH = path.join(
  process.cwd(),
  "src/skins/ledgerline/mcp-app/dist/ledgerline-app.html",
);

async function loadAppHtml(): Promise<string> {
  try {
    return await readFile(LEDGERLINE_APP_HTML_PATH, "utf8");
  } catch (error) {
    console.error(
      "[ledgerline/mcp] the MCP app bundle is missing; run `node scripts/build-ledgerline-mcp-app.mjs`",
      error,
    );
    return `<!doctype html><html><body style="font-family:system-ui;padding:16px">The Ledgerline app bundle has not been built. Run <code>node scripts/build-ledgerline-mcp-app.mjs</code>.</body></html>`;
  }
}

/** How long an identical widget-bound call counts as a repeat of the last one. */
export const REPEAT_WINDOW_MS = 20_000;
const lastCalls = new Map<string, number>();

/**
 * True when this exact call already OPENED A CARD within `REPEAT_WINDOW_MS`.
 * Only a call that drew a card is remembered (`cardShown`): a refusal draws
 * none, so a retry after a refusal, or after the hold is cleared, runs again.
 */
export function isRepeatCall(
  tool: string,
  args: unknown,
  now = Date.now(),
): boolean {
  for (const [k, at] of lastCalls)
    if (now - at > REPEAT_WINDOW_MS) lastCalls.delete(k);
  return lastCalls.has(`${tool}:${JSON.stringify(args)}`);
}

/** Remember that this call drew a card, so ChatGPT's duplicate of it collapses. */
export function cardShown(tool: string, args: unknown, now = Date.now()): void {
  lastCalls.set(`${tool}:${JSON.stringify(args)}`, now);
}

export function resetRepeatCalls(): void {
  lastCalls.clear();
}

function repeatResult(tool: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: `This is a repeat of the ${tool} call just made; its card is already on screen above. Do not call it again; answer from the first result.`,
      },
    ],
    structuredContent: {
      kind: "repeat",
      note: `Repeat of ${tool}: the first card is already on screen.`,
    },
  };
}

function result(out: ToolOutput) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(out) }],
    structuredContent: out,
    isError: "error" in out ? true : undefined,
  };
}

export function createLedgerlineMcpServer({
  callerKey,
  collapseRepeats = false,
}: {
  callerKey: string;
  /** On for ChatGPT, which repeats widget-bound calls. */
  collapseRepeats?: boolean;
}): McpServer {
  const server = new McpServer(
    { name: "ledgerline", version: "1.0.0" },
    { instructions: INSTRUCTIONS },
  );

  registerAppResource(
    server,
    "Ledgerline",
    LEDGERLINE_APP_URI,
    {
      description:
        "Ledgerline's report card and Review matches card, the same components the Ledgerline web app renders.",
    },
    async () => ({
      contents: [
        {
          uri: LEDGERLINE_APP_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await loadAppHtml(),
          _meta: { ui: { prefersBorder: false, csp: {} } },
        },
      ],
    }),
  );

  const callerOf = (extra: { _meta?: Record<string, unknown> } | undefined) => {
    const subject = extra?._meta?.["openai/subject"];
    return typeof subject === "string" ? `openai:${subject}` : callerKey;
  };

  /** A tool bound to the MCP app: the model's call opens a card, or (app) only the card calls it. */
  const regApp = (
    name: HandlerName,
    config: {
      title: string;
      description: string;
      inputSchema: Record<string, z.ZodTypeAny>;
      readOnly: boolean;
      visibility: "model" | "app";
      invoking?: string;
    },
  ) =>
    registerAppTool(
      server,
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
        _meta:
          config.visibility === "model"
            ? {
                ui: { resourceUri: LEDGERLINE_APP_URI },
                "openai/toolInvocation/invoking":
                  config.invoking ?? config.title,
                "openai/toolInvocation/invoked": "Ready",
              }
            : { ui: { visibility: ["app"] }, "openai/widgetAccessible": true },
      },
      async (
        args: Record<string, unknown>,
        extra: { _meta?: Record<string, unknown> },
      ) => {
        const collapse = config.visibility === "model" && collapseRepeats;
        if (collapse && isRepeatCall(name, args)) return repeatResult(name);
        const out = runTool(name, args, callerOf(extra));
        if (collapse && !("error" in out)) cardShown(name, args);
        return result(out);
      },
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
  regApp("getReport", {
    title: "Get an expense report",
    description:
      "Read one expense report: line items, total, cost center, notes and any policy holds. Shown to the user as Ledgerline's report card.",
    inputSchema: { reportId: z.string().describe("Report id, e.g. EXP-2291.") },
    readOnly: true,
    visibility: "model",
    invoking: "Reading the report",
  });
  regApp("reviewMatches", {
    title: "Review matches",
    description:
      "Hand the matches you prepared in a reconciliation session to the user: opens Ledgerline's Review matches card. You never close a period; only the user's Confirm in the card validates and closes it. Do not ask for confirmation in chat first.",
    inputSchema: { sessionId: z.string() },
    readOnly: true,
    visibility: "model",
    invoking: "Preparing the review",
  });
  regApp("confirmMatches", {
    title: "Confirm matches",
    description:
      "Called only by the Review matches card when the user confirms: validates the session, then closes the period.",
    inputSchema: { sessionId: z.string() },
    readOnly: false,
    visibility: "app",
  });
  reg("ledgerlineApi", {
    title: "Call the Ledgerline API",
    description: LEDGERLINE_API_DESCRIPTION,
    inputSchema: {
      method: z.enum(["GET", "POST", "PATCH", "PUT", "DELETE"]),
      path: z.string().describe("e.g. /reports/EXP-2291"),
      body: z
        .union([z.record(z.string(), z.unknown()), z.string()])
        .optional()
        .describe(
          "JSON body (an object, or a JSON string), for endpoints that take one.",
        ),
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
