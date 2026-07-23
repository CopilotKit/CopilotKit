/**
 * Agent backend for the Slack triage assistant.
 *
 * This is the brain behind the Slack bridge: a single CopilotKit
 * `BuiltInAgent` (LLM + MCP) served over AG-UI by a `CopilotSseRuntime`.
 * It replaces the old vendored Python/LangGraph showcase backend — there
 * is no Python, no `langgraph dev`, no A2UI middleware. Everything is a
 * few dozen lines of TypeScript.
 *
 * What it does
 * ------------
 * The agent connects to **Linear** and **Notion** via their MCP servers
 * and acts as an on-call / triage assistant inside Slack: it pulls and
 * files Linear issues, finds Notion runbooks, and writes incident
 * threads up as Notion postmortems. The data access is entirely MCP —
 * the agent discovers the available tools (list/search/create issues,
 * search/create pages) from each server at runtime.
 *
 * The Slack-side primitives (read_thread, the confirm_write HITL picker,
 * the issue/page Block Kit components) are forwarded to the agent as
 * client-provided tools by the bridge on every run — see `app/index.ts`.
 *
 * Auth & deployment
 * -----------------
 * Every connection is env-driven, so the same process runs locally and
 * deployed — only the env differs (see `.env.example`):
 *
 *   - Linear: the hosted MCP accepts a raw API key as a bearer token, so
 *     we connect straight to `LINEAR_MCP_URL` with `LINEAR_API_KEY`.
 *   - Notion: run the official `@notionhq/notion-mcp-server` as a
 *     Streamable-HTTP sidecar (`pnpm notion-mcp` locally, a second
 *     process/container in prod) and point `NOTION_MCP_URL` /
 *     `NOTION_MCP_AUTH_TOKEN` at it.
 *
 * A server is only wired up when its credentials are present, so the bot
 * runs Linear-only, Notion-only, or both.
 *
 * Exposed route (the bridge's `AGENT_URL`):
 *   POST http://localhost:8200/api/copilotkit/agent/triage/run
 */
import "dotenv/config";
import { createServer } from "node:http";
import {
  BuiltInAgent,
  CopilotSseRuntime,
  convertInputToTanStackAI,
} from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { webSearchTool } from "@tanstack/ai-openai/tools";
import { createMCPClient } from "@tanstack/ai-mcp";

const LINEAR_TEAM_KEY = process.env["LINEAR_TEAM_KEY"] ?? "CPK";

/**
 * HTTP MCP transports (Linear hosted + Notion sidecar), each carrying a static
 * `Authorization: Bearer`. TanStack AI's `chat()` connects these per run and
 * closes them when the run ends (its `mcp.connection: "close"` default), so we
 * just describe the transports here and create fresh clients inside the agent
 * factory on each turn.
 */
interface McpHttpTransport {
  type: "http";
  url: string;
  headers: Record<string, string>;
}

/** A transport plus the human label we surface when it's up or down. */
interface LabeledTransport {
  name: string;
  transport: McpHttpTransport;
}

function mcpTransports(): LabeledTransport[] {
  const transports: LabeledTransport[] = [];
  if (process.env["LINEAR_API_KEY"]) {
    transports.push({
      name: "Linear",
      transport: {
        type: "http",
        url: process.env["LINEAR_MCP_URL"] ?? "https://mcp.linear.app/mcp",
        headers: { Authorization: `Bearer ${process.env["LINEAR_API_KEY"]}` },
      },
    });
  }
  if (process.env["NOTION_MCP_AUTH_TOKEN"]) {
    transports.push({
      name: "Notion",
      transport: {
        type: "http",
        url: process.env["NOTION_MCP_URL"] ?? "http://127.0.0.1:3001/mcp",
        headers: {
          Authorization: `Bearer ${process.env["NOTION_MCP_AUTH_TOKEN"]}`,
        },
      },
    });
  }
  return transports;
}

/** Max time to wait for an MCP server to connect before giving up on it. */
const MCP_CONNECT_TIMEOUT_MS = 8000;

/**
 * Connect one MCP client without ever taking the run down with it. A server
 * that's misconfigured (bad key), down (sidecar not running), or hanging must
 * NOT abort the turn — the agent should keep working with whatever else is
 * available. We race the connect against a timeout and swallow a late failure
 * so it can't surface as an unhandled rejection after we've moved on.
 */
async function connectMcp(transport: McpHttpTransport) {
  const connecting = createMCPClient({ transport });
  connecting.catch(() => {}); // late reject (post-timeout) must not crash the process
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out after ${MCP_CONNECT_TIMEOUT_MS}ms`)),
      MCP_CONNECT_TIMEOUT_MS,
    );
    timer.unref?.(); // don't keep the process alive on the timer alone
  });
  try {
    return await Promise.race([connecting, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

if (mcpTransports().length === 0) {
  console.warn(
    "[slack-runtime] No MCP servers configured. Set LINEAR_API_KEY and/or " +
      "NOTION_MCP_AUTH_TOKEN in .env — without them the bot can chat and " +
      "search the web but can't read or write Linear/Notion.",
  );
}

const SYSTEM_PROMPT = [
  "You are an on-call triage assistant living in a Slack workspace. You help",
  "an engineering team turn incident chatter into tracked work: you pull and",
  "file Linear issues, find Notion runbooks, and write incident threads up as",
  "Notion postmortems.",
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
  '- For "my issues" / "assigned to me": set assignee to the requesting user\'s',
  '  email (it\'s in your context) or the literal "me" — both work.',
  "- The state filter takes a Linear state TYPE (backlog, unstarted, started,",
  '  completed, canceled) or a specific state name — NOT "open" or "closed". For',
  '  "open" issues, OMIT the state filter entirely (state:"open" returns nothing).',
  '- There is no cycle:"current"/"active" value. For "this cycle", just list the',
  "  team's issues (omit the cycle filter) unless the user names a cycle number.",
  "- QUERY ONCE. Call list_issues a SINGLE time with the team key + any needed",
  "  filter. Do NOT paginate or re-run it with different filter combinations to",
  "  gather every issue — one query is enough. If the result set is large, render",
  "  the ~15 most recent and note the rest (e.g. 'showing 15 of 39') instead of",
  "  dumping the whole backlog; a 39-row card is noise, not an answer.",
  "- Use get_issue for one issue; render it with issue_card.",
  "- To act on a Slack conversation (e.g. 'write this thread up'), call the",
  "  read_thread tool to fetch the messages first — never invent thread content.",
  "",
  "Files & visuals: uploaded files arrive in the message as content you can",
  "read — images and PDFs directly, and CSV/JSON/text as decoded text. When a",
  "user uploads data and wants a chart, parse it and call render_chart with a",
  "Chart.js config OBJECT — pick a sensible type (bar/line/pie) and inline the",
  "data. When the user wants the data itself shown as a table (not a chart),",
  "call render_table with columns + rows (each row an array of cell values in",
  "column order; set a column's align to 'right' for numeric columns). When",
  "asked to diagram a flow/architecture/timeline, call render_diagram with",
  "Mermaid source. render_chart and render_diagram post an image; render_table",
  "posts a Slack table. If render_diagram returns an error, fix the Mermaid and",
  "retry. These are read/reply actions — no confirm_write needed.",
  "- render_chart / render_diagram post a TITLED image themselves (a caption",
  "  header followed by the image). Do NOT narrate the act with a separate",
  '  "Charting `file.csv`…" line or a "rendered above/below" sentence — that',
  "  text lands AFTER the image and reads out of order. Let the titled image be",
  "  the answer; if you must reply, ONE short past-tense clause naming the file",
  '  is enough (e.g. "Charted `incidents-2026.csv`.").',
  "- If more than one file is in the thread and the request doesn't make clear",
  "  which one to use, ASK which file (list them by name) instead of guessing.",
  "",
  "Acting per-user: each turn's context names the Requesting Slack user, with",
  'their name and email. When someone says "my issues", "assigned to me", or',
  '"file this for me", use that email/name to find their Linear user, then:',
  "- Querying: filter Linear by that person (assignee), so each user gets THEIR",
  "  issues — not everyone's.",
  "- Creating: set the new issue's assignee to that person and @mention them.",
  "  (Heads up: issues are still authored by the bot's API key, so the Linear",
  "  'creator' is the bot — assignee is how you attribute work to the requester.)",
  "Never assume every request is from the same person; always use the requester",
  "named in context. If their email isn't in context, say so rather than guessing.",
  "",
  "RENDERING — THIS IS A HARD RULE. Whenever your answer contains structured",
  "output, you MUST call the matching render tool and let IT draw the card. Do",
  "NOT reproduce that content as Markdown bullets, a table, or prose — a hand-",
  "written list/table/card is a BUG, not an answer. Map the request to a tool and",
  "call it FIRST, then add at most one short sentence around it:",
  "- Several Linear issues          -> issue_list",
  "- A single Linear issue          -> issue_card (and right after you create one, justCreated: true)",
  "- Notion pages                   -> page_list",
  "- Tabular data / 'as a table'    -> render_table (columns + rows)",
  "- A status / metrics / health summary (counts, KPIs, label/value pairs)",
  "                                 -> show_status (heading + fields:[{label,value}])",
  "- An incident / outage           -> show_incident (id, title, severity SEV1|SEV2|SEV3,",
  "                                    summary) — an interactive card with Acknowledge/Escalate",
  "- A set of links / runbooks      -> show_links (heading + links:[{label,url}])",
  "- A chart from data              -> render_chart;   a flow/architecture/timeline -> render_diagram",
  "If the user explicitly asks for a card/table/incident/status/links, calling the",
  "tool IS the whole answer — never describe what the card 'would' contain in prose.",
  "Your text message alongside a rendered card MUST be empty or ONE short line (e.g.",
  '"Open CPK issues:"). NEVER restate the issues/rows/fields as text after rendering',
  "— the card already shows them, and a duplicate text wall is the single most",
  "annoying thing you can do. Render, then stop.",
  "- ALWAYS populate each issue's state and priority as plain strings (e.g.",
  '  state:"In Progress", priority:"High") on the component props — the cards',
  "  use them for the status dot and the colored border. The Linear MCP returns",
  '  priority as an object {value, name}; pass its NAME string (e.g. "High"),',
  "  not the object. Map the issue's workflow status into state. Include",
  "  assignee, url, and updated too when you have them.",
  "",
  "WRITE GATING: a 'write' is CREATING or MODIFYING something in Linear or Notion",
  "(create_issue, update_issue, create_page, …). ONLY before such a write, call the",
  "confirm_write tool with a one-line summary and wait for approval; perform the",
  "write only if confirmed. Rendering a card/table (issue_list, issue_card,",
  "show_incident, show_status, show_links, render_table, render_chart/diagram) and",
  "any read (search/list/get) are NOT writes — never gate them, and never add an",
  "'I'll need approval' disclaimer to a pure render or read.",
].join("\n");

// OpenAI-only here: web search is an OpenAI hosted (provider) tool, so this
// agent runs on the OpenAI Responses API via TanStack AI's `openaiText`
// adapter. Override the model with AGENT_MODEL (a bare OpenAI id, or
// "openai/<id>" — the prefix is stripped); defaults to gpt-5.5. The cast is
// needed because AGENT_MODEL is dynamic and `openaiText` types its argument to
// the known OpenAI model literals.
const model = (process.env["AGENT_MODEL"] ?? "openai/gpt-5.5").replace(
  /^openai\//,
  "",
) as Parameters<typeof openaiText>[0];

// Factory mode: we own the LLM call (TanStack AI `chat()`); BuiltInAgent owns
// the AG-UI run lifecycle and converts TanStack's stream into AG-UI events.
// `chat()` runs the multi-turn tool loop, the OpenAI `web_search` provider
// tool, and the MCP tools — discovering MCP tools and closing the connections
// when the run ends. The big triage prompt is prepended as a system prompt,
// ahead of any system/context/state prompts derived from the run input.
const agent = new BuiltInAgent({
  type: "tanstack",
  factory: async (ctx) => {
    const {
      messages,
      systemPrompts,
      tools: clientTools,
    } = convertInputToTanStackAI(ctx.input);

    // Connect each MCP server independently so one bad/unreachable server can't
    // kill the turn. Failures are dropped (the agent runs with whatever else is
    // up) and noted so the model only tells the user a source is down if they
    // actually ask for it — see `availabilityNote` below.
    const transports = mcpTransports();
    const settled = await Promise.allSettled(
      transports.map((t) => connectMcp(t.transport)),
    );
    const clients: Array<Awaited<ReturnType<typeof connectMcp>>> = [];
    const unavailable: string[] = [];
    settled.forEach((result, i) => {
      if (result.status === "fulfilled") {
        clients.push(result.value);
      } else {
        unavailable.push(transports[i]!.name);
        console.error(
          `[slack-runtime] MCP "${transports[i]!.name}" unavailable this turn:`,
          (result.reason as Error)?.message ?? result.reason,
        );
      }
    });

    // Tell the model which sources are down THIS turn so it degrades gracefully:
    // keep answering with everything that works, and only surface the outage if
    // the user's request needs the missing source (never invent data).
    const isAre = unavailable.length > 1 ? "are" : "is";
    const itsTheir = unavailable.length > 1 ? "their" : "its";
    const availabilityNote =
      unavailable.length > 0
        ? `\n\nDATA SOURCE STATUS: ${unavailable.join(" and ")} ${isAre} ` +
          `temporarily UNAVAILABLE this turn (connection failed), so ${itsTheir} ` +
          `tools are not loaded. Everything else — web search, rendering cards/` +
          `charts, reading the Slack thread — still works normally. ONLY if the ` +
          `user asks for something that needs ${unavailable.join(" or ")}, tell ` +
          `them that source is temporarily unreachable and to try again shortly; ` +
          `never invent data or claim a write/read succeeded.`
        : "";

    return chat({
      adapter: openaiText(model),
      messages,
      systemPrompts: [SYSTEM_PROMPT + availabilityNote, ...systemPrompts],
      // `web_search` is an OpenAI provider tool (run server-side by OpenAI);
      // `clientTools` are the bot's frontend tools (issue/page cards, charts,
      // confirm_write HITL) forwarded on every run — passed as client-side
      // tools so the model can call them and the bot renders/gates them via
      // the AG-UI client-tool round-trip. MCP tools come in via `mcp` below.
      tools: [
        webSearchTool({ type: "web_search" }),
        ...(clientTools as never[]),
      ],
      ...(clients.length > 0 ? { mcp: { clients } } : {}),
      // TanStack AI needs the full AbortController (not just the signal).
      abortController: ctx.abortController,
    });
  },
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
    `[slack-runtime] listening on http://localhost:${port}/api/copilotkit/agent/triage/run`,
  );
  const connected = [
    process.env["LINEAR_API_KEY"] ? "Linear" : null,
    process.env["NOTION_MCP_AUTH_TOKEN"] ? "Notion" : null,
  ].filter(Boolean);
  console.log(
    `[slack-runtime] agent "triage" ready · MCP: ${
      connected.length ? connected.join(", ") : "none"
    }`,
  );
});
