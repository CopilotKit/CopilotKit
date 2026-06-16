/**
 * Agent backend for the WhatsApp triage assistant.
 *
 * This is the brain behind the WhatsApp bridge: a single CopilotKit
 * `BuiltInAgent` (LLM + MCP) served over AG-UI by a `CopilotSseRuntime`.
 * There is no Python, no `langgraph dev`, no A2UI middleware — everything is
 * a few dozen lines of TypeScript.
 *
 * What it does
 * ------------
 * The agent connects to **Linear** and **Notion** via their MCP servers and
 * acts as an on-call / triage assistant inside WhatsApp: it pulls and files
 * Linear issues and finds Notion runbooks/postmortems. Data access is entirely
 * MCP — the agent discovers the available tools (list/search/create issues,
 * search/create pages) from each server at runtime.
 *
 * The WhatsApp-side primitives (the issue_list / show_incident render-tools and
 * the confirm_write HITL gate) are forwarded to the agent as client-provided
 * tools by the bridge on every run — see `app/index.ts`.
 *
 * Auth & deployment
 * -----------------
 * Every connection is env-driven, so the same process runs locally and
 * deployed — only the env differs (see `.env.example`):
 *
 *   - Linear: the hosted MCP accepts a raw API key as a bearer token, so we
 *     connect straight to `LINEAR_MCP_URL` with `LINEAR_API_KEY`.
 *   - Notion: run the official `@notionhq/notion-mcp-server` as a
 *     Streamable-HTTP sidecar (`pnpm notion-mcp` locally, a second
 *     process/container in prod) and point `NOTION_MCP_URL` /
 *     `NOTION_MCP_AUTH_TOKEN` at it.
 *
 * A server is only wired up when its credentials are present, so the bot runs
 * Linear-only, Notion-only, or both.
 *
 * Exposed route (the bridge's `AGENT_URL`):
 *   POST http://localhost:8200/api/copilotkit/agent/triage/run
 */
import "dotenv/config";
import { createServer } from "node:http";
import {
  BuiltInAgent,
  CopilotSseRuntime,
  resolveModel,
} from "@copilotkit/runtime/v2";
import type {
  BuiltInAgentModel,
  MCPClientConfig,
} from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";

/**
 * An HTTP MCP server that injects a static `Authorization: Bearer` on every
 * outbound request. `MCPClientConfigHTTP` has no `headers` field; the SDK's
 * documented extension point is `options.fetch`, so we wrap `fetch` to set the
 * header (mirrors how the runtime injects its own intelligence-MCP credentials).
 */
function bearerMcpServer(url: string, token: string): MCPClientConfig {
  return {
    type: "http",
    url,
    options: {
      fetch: async (req, init) => {
        const headers = new Headers(init?.headers);
        headers.set("Authorization", `Bearer ${token}`);
        return globalThis.fetch(req, { ...init, headers });
      },
    },
  };
}

const LINEAR_TEAM_KEY = process.env["LINEAR_TEAM_KEY"] ?? "CPK";

const mcpServers: MCPClientConfig[] = [];

if (process.env["LINEAR_API_KEY"]) {
  mcpServers.push(
    bearerMcpServer(
      process.env["LINEAR_MCP_URL"] ?? "https://mcp.linear.app/mcp",
      process.env["LINEAR_API_KEY"],
    ),
  );
}

if (process.env["NOTION_MCP_AUTH_TOKEN"]) {
  mcpServers.push(
    bearerMcpServer(
      process.env["NOTION_MCP_URL"] ?? "http://127.0.0.1:3001/mcp",
      process.env["NOTION_MCP_AUTH_TOKEN"],
    ),
  );
}

if (mcpServers.length === 0) {
  console.warn(
    "[whatsapp-runtime] No MCP servers configured. Set LINEAR_API_KEY and/or " +
      "NOTION_MCP_AUTH_TOKEN in .env — without them the bot can chat but " +
      "can't read or write Linear/Notion.",
  );
}

const SYSTEM_PROMPT = [
  "You are an on-call triage assistant reachable over WhatsApp. You help an",
  "engineering team turn incident reports into tracked work: you pull and file",
  "Linear issues and find Notion runbooks/postmortems.",
  "",
  "Data access:",
  "- Linear and Notion are connected via MCP. Use those tools to search, read,",
  `  and create issues and pages. The default Linear team is "${LINEAR_TEAM_KEY}"`,
  "  unless the user names another team.",
  "",
  "Linear tool tips (the filters are picky — follow these to avoid empty results):",
  `- Pass the team KEY directly to list_issues, e.g. {team: "${LINEAR_TEAM_KEY}"}. Do`,
  "  NOT call list_teams to look a team up by its key — list_teams matches the",
  '  team\'s full NAME, not its key, so a key like "CPK" returns nothing. If you',
  "  must resolve a team, use get_team with the key.",
  '- For "my issues" / "assigned to me": set assignee to the literal "me".',
  "- The state filter takes a Linear state TYPE (backlog, unstarted, started,",
  '  completed, canceled) or a specific state name — NOT "open" or "closed". For',
  '  "open" issues, OMIT the state filter entirely (state:"open" returns nothing).',
  '- There is no cycle:"current"/"active" value. For "this cycle", just list the',
  "  team's issues (omit the cycle filter) unless the user names a cycle number.",
  "- QUERY ONCE. Call list_issues a SINGLE time with the team key + any needed",
  "  filter. Do NOT paginate or re-run it with different filter combinations to",
  "  gather every issue — one query is enough. If the result set is large, render",
  "  the ~15 most recent and note the rest (e.g. 'showing 15 of 39') instead of",
  "  dumping the whole backlog.",
  "- Use get_issue for one issue.",
  "",
  "RENDERING — THIS IS A HARD RULE. WhatsApp is a plain-text surface: there are",
  "no rich cards, tables, diagrams, or threads — only text, images, interactive",
  "reply buttons (max 3), and lists. Keep every reply concise. When your answer",
  "is structured, call the matching render tool and let IT draw the reply; do NOT",
  "also restate the same content as prose — a duplicate text wall after a render",
  "is a BUG, not an answer. Map the request to a tool and call it FIRST, then add",
  "at most one short line around it:",
  "- Several Linear issues   -> issue_list (id, title, optional state, optional url)",
  "- An incident / outage     -> show_incident (id, title, severity SEV1|SEV2|SEV3,",
  "                              summary) — an interactive reply with Acknowledge/Escalate",
  "- Data to visualize        -> render_chart (type bar/line/pie/doughnut, labels,",
  "                              datasets:[{label,data}]) — posts a chart image",
  "For a single issue or a set of Notion pages, just write a short, concise text",
  "reply (there is no card/table tool on WhatsApp). Never invent a table — that",
  "surface doesn't exist here; for data the user wants visualized, use render_chart.",
  "",
  "WRITE GATING: a 'write' is CREATING or MODIFYING something in Linear or Notion",
  "(create_issue, update_issue, create_page, …). ONLY before such a write, call the",
  "confirm_write tool with a one-line summary and wait for approval; perform the",
  "write only if it returns confirmed. Rendering (issue_list, show_incident) and",
  "any read (search/list/get) are NOT writes — never gate them, and never add an",
  "'I'll need approval' disclaimer to a pure render or read.",
].join("\n");

const model =
  (process.env["AGENT_MODEL"] as BuiltInAgentModel) ?? "openai/gpt-5.5";

// Fail loud at startup on a misspelled provider/model rather than on the
// first agent invocation. (The model's API key is read from env at run time.)
try {
  resolveModel(model);
} catch (err) {
  console.error(`[whatsapp-runtime] invalid AGENT_MODEL "${model}":`, err);
  process.exit(1);
}

const agent = new BuiltInAgent({
  model,
  // Triage chains several MCP calls per turn (search -> read -> confirm ->
  // create), so give the agent room to loop.
  maxSteps: Number(process.env["AGENT_MAX_STEPS"] ?? 12),
  mcpServers,
  prompt: SYSTEM_PROMPT,
});

const runtime = new CopilotSseRuntime({
  agents: { triage: agent },
});

const listener = createCopilotNodeListener({
  runtime,
  basePath: "/api/copilotkit",
  cors: true,
});

const port = Number(process.env["PORT"] ?? 8200);
createServer(listener).listen(port, () => {
  console.log(
    `[whatsapp-runtime] listening on http://localhost:${port}/api/copilotkit/agent/triage/run`,
  );
  const connected = [
    process.env["LINEAR_API_KEY"] ? "Linear" : null,
    process.env["NOTION_MCP_AUTH_TOKEN"] ? "Notion" : null,
  ].filter(Boolean);
  console.log(
    `[whatsapp-runtime] agent "triage" ready · MCP: ${
      connected.length ? connected.join(", ") : "none"
    }`,
  );
});
