import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { registerSearchTool } from "fumadocs-core/mcp";
import { z } from "zod";
import { liveSearch } from "@/lib/llms/live-search";
import { getPageMarkdown, listPages } from "@/lib/llms/page-tools";

// The docs' MCP server for outside agents (Claude Code, Cursor, ...):
// `list_pages`, `get_page`, and `search`, the tools Fumadocs' own
// `registerSourceTools` / `registerSearchTool` register, over the live docs
// (every docs.copilotkit.ai URL, framework-scoped ones included) and the
// /docs pages. Connect with
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

export async function GET(request: Request) {
  return handler.fetch(request);
}

export async function POST(request: Request) {
  return handler.fetch(request);
}

export async function DELETE(request: Request) {
  return handler.fetch(request);
}
