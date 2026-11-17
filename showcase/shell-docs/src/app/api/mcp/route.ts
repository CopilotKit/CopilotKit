import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { registerSearchTool } from "fumadocs-core/mcp";
import { z } from "zod";
import { liveSearch } from "@/lib/llms/live-search";
import { getPageMarkdown, listPages } from "@/lib/llms/page-tools";
import { clientKey, createRateLimit } from "@/lib/rate-limit";

// The docs' MCP server for outside agents (Claude Code, Cursor, ...):
// `list_pages`, `get_page`, and `search`, the tools Fumadocs' own
// `registerSourceTools` / `registerSearchTool` register, over the live docs
// (every docs.copilotkit.ai URL, framework-scoped ones included). Connect with
// { "mcpServers": { "copilotkit-docs": { "url": "<site>/api/mcp" } } }.

const handler = createMcpHandler(() => {
  const mcp = new McpServer({ name: "copilotkit-docs", version: "1.0.0" });
  mcp.registerTool(
    "list_pages",
    {
      title: "List Pages",
      description: "List all docs pages with their pathnames (URLs)",
      inputSchema: z.object({}),
    },
    async () => ({ content: [{ type: "text", text: await listPages() }] }),
  );
  mcp.registerTool(
    "get_page",
    {
      title: "Get Page",
      description:
        "Get the Markdown content of a docs page by its pathname (URL), like /frontend-tools or /mastra/quickstart",
      inputSchema: z.object({ url: z.string() }),
    },
    async ({ url }) => {
      const text = await getPageMarkdown(url);
      return text === null
        ? {
            content: [{ type: "text", text: `page not found: ${url}` }],
            isError: true,
          }
        : { content: [{ type: "text", text }] };
    },
  );
  registerSearchTool(mcp, liveSearch);
  return mcp;
});

// Calls per client. Every page read renders the page's Markdown, so a busy
// agent can read the site at a good clip, but one client can't keep the
// server rendering for everyone else.
const perMinute = createRateLimit({ limit: 120, windowMs: 60_000 });

function limited(request: Request): Response | null {
  const result = perMinute(clientKey(request));
  return result.ok
    ? null
    : Response.json(
        { error: "Too many requests. Try again in a moment." },
        { status: 429, headers: { "Retry-After": String(result.retryAfter) } },
      );
}

export async function GET(request: Request) {
  return limited(request) ?? handler.fetch(request);
}

export async function POST(request: Request) {
  return limited(request) ?? handler.fetch(request);
}

export async function DELETE(request: Request) {
  return handler.fetch(request);
}
