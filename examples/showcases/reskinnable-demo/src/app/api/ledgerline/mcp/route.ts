import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createLedgerlineMcpServer } from "@/skins/ledgerline/mcp/server";

/**
 * Ledgerline's MCP server over Streamable HTTP, at `/api/ledgerline/mcp` (for ChatGPT).
 *
 * STATELESS: a fresh server and transport per request (no session id), which
 * is what a serverless-style Next route wants and what both Claude connectors
 * and ChatGPT developer mode accept. JSON responses rather than SSE, since no
 * tool streams.
 *
 * No auth: this is a demo ledger. Anyone holding the tunnel URL can approve a
 * demo report, so treat the URL as the secret and stop the tunnel after the demo.
 *
 * Under `/api`, so the LOCK_SKIN proxy never rewrites it.
 */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers":
    "content-type, accept, authorization, mcp-session-id, mcp-protocol-version, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
};

async function handle(req: Request): Promise<Response> {
  // LEDGERLINE_MCP_LOG=1 logs each JSON-RPC method (and tool or resource) with the
  // client's user agent: the quickest way to see whether ChatGPT or Claude is
  // reaching the server, and how often it calls a tool. Off by default.
  if (process.env.LEDGERLINE_MCP_LOG) {
    const body = await req.clone().text();
    let line = body.slice(0, 300);
    try {
      const msgs = [JSON.parse(body)].flat() as {
        method?: string;
        params?: { name?: string; uri?: string };
      }[];
      line = msgs
        .map((m) =>
          [m.method, m.params?.name ?? m.params?.uri].filter(Boolean).join(" "),
        )
        .join(", ");
    } catch {
      // Not JSON: log the head as is.
    }
    console.log("[ledgerline/mcp]", req.headers.get("user-agent"), line);
  }
  // ChatGPT identifies itself as `openai-mcp/<version>`; the caller key groups
  // its calls into one Thread when the request carries no `openai/subject`.
  const server = createLedgerlineMcpServer({
    callerKey: req.headers.get("user-agent") ?? "mcp-client",
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    const res = await transport.handleRequest(req);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  } catch (error) {
    console.error("[ledgerline/mcp] request failed", error);
    return Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      },
      { status: 500, headers: CORS },
    );
  }
}

export const POST = handle;

// Stateless, so there is no standalone server-to-client SSE stream to open and
// no session to delete. 405 is the spec's answer, and every client handles it;
// letting GET through would hold an idle stream open per connection.
const notAllowed = async () =>
  new Response(null, {
    status: 405,
    headers: { ...CORS, allow: "POST, OPTIONS" },
  });
export const GET = notAllowed;
export const DELETE = notAllowed;
export const OPTIONS = async () =>
  new Response(null, { status: 204, headers: CORS });
