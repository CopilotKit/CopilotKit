import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { parallelServer } from "../lib/parallel-config";
import { readSources } from "../lib/sources";

// Explicit live check: sends only this public query and the returned URL to Parallel.
const config = parallelServer(process.env.PARALLEL_API_KEY);
const client = new Client({
  name: "copilotkit-parallel-showcase-check",
  version: "1.0.0",
});
try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL(config.url), config.options),
  );
  const { tools } = await client.listTools();
  for (const name of ["web_search", "web_fetch"]) {
    const tool = tools.find((candidate) => candidate.name === name);
    assert.ok(tool, `Missing ${name}`);
    const properties = tool.inputSchema.properties ?? {};
    assert.ok("client_model" in properties, `${name} is missing client_model`);
    assert.ok(
      !("model_name" in properties),
      `${name} unexpectedly accepts model_name`,
    );
  }
  const searchQueries = ["site:docs.copilotkit.ai MCP servers"];
  const search = await client.callTool({
    name: "web_search",
    arguments: {
      objective:
        "Find the official CopilotKit documentation for connecting MCP servers.",
      search_queries: searchQueries,
    },
  });
  assert.ok(!search.isError, "Search returned an MCP error");
  const { sources } = readSources(search);
  assert.ok(sources.length, "Search returned no usable sources");
  const structuredContent = search.structuredContent as
    | Record<string, unknown>
    | undefined;
  const sessionId = structuredContent?.session_id;
  assert.ok(
    typeof sessionId === "string" && sessionId,
    "Search returned no session_id",
  );
  const fetch = await client.callTool({
    name: "web_fetch",
    arguments: {
      urls: [sources[0].url],
      objective:
        "Read the page for MCP server connection and authentication guidance.",
      search_queries: searchQueries,
      session_id: sessionId,
    },
  });
  assert.ok(!fetch.isError, "Fetch returned an MCP error");
  assert.ok(
    readSources(fetch).sources.length,
    "Fetch returned no usable sources",
  );
  console.log(
    "Passed: live tool discovery, search, fetch, and source parsing.",
  );
} finally {
  await client.close();
}
