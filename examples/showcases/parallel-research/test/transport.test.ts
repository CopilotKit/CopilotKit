import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { parallelServer } from "../lib/parallel-config";

test("HTTP transport sends optional Bearer auth on actual MCP requests", async () => {
  const requests: Request[] = [];
  const transport = new StreamableHTTPClientTransport(new URL("https://example.test/mcp"), {
    ...parallelServer("test-key").options,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.method !== "POST") return new Response(null, { status: 405 });
      const body = await request.json();
      if (body.id === undefined) return new Response(null, { status: 202 });
      return Response.json({ jsonrpc: "2.0", id: body.id, result: body.method === "initialize"
        ? { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "test", version: "1" } }
        : { tools: [{ name: "web_search", inputSchema: { type: "object" } }] } });
    },
  });
  const client = new Client({ name: "test", version: "1" });
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools[0].name, "web_search");
    assert.ok(requests.length >= 3);
    assert.ok(requests.every((request) => request.headers.get("authorization") === "Bearer test-key"));
  } finally { await client.close(); }
});
