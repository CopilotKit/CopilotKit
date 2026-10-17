import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { parallelServer } from "../lib/parallel-config";
import { readSources } from "../lib/sources";

// Explicit live check: sends only this public query and the returned URL to Parallel.
const config = parallelServer(process.env.PARALLEL_API_KEY);
const client = new Client({ name: "copilotkit-parallel-showcase-check", version: "1.0.0" });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(config.url), config.options));
  const { tools } = await client.listTools();
  for (const name of ["web_search", "web_fetch"]) assert.ok(tools.some((tool) => tool.name === name), `Missing ${name}`);
  const session_id = randomUUID();
  const search = await client.callTool({ name: "web_search", arguments: {
    objective: "Find the official CopilotKit documentation for connecting MCP servers.",
    search_queries: ["site:docs.copilotkit.ai MCP servers"], session_id,
  } });
  assert.ok(!search.isError, "Search returned an MCP error");
  const { sources } = readSources(search);
  assert.ok(sources.length, "Search returned no usable sources");
  const fetch = await client.callTool({ name: "web_fetch", arguments: { urls: [sources[0].url], session_id } });
  assert.ok(!fetch.isError, "Fetch returned an MCP error");
  assert.ok(readSources(fetch).sources.length, "Fetch returned no usable sources");
  console.log("Passed: live tool discovery, search, fetch, and source parsing.");
} finally {
  await client.close();
}
