import assert from "node:assert/strict";
import { test } from "node:test";
import { readSources } from "../lib/sources";
import { parallelServer } from "../lib/parallel-config";

test("renders sources from serialized MCP text blocks and deduplicates structured content", () => {
  const result = { results: [{ url: "https://example.com/article", title: "Article" }] };
  assert.deepEqual(readSources(JSON.stringify({ structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] })), {
    sources: [{ url: "https://example.com/article", title: "Article" }], failed: false, recognized: true,
  });
});
test("renders sources from serialized text-only MCP results", () => {
  const result = JSON.stringify({ content: [{ type: "text", text: JSON.stringify({
    results: [{ url: "https://example.com/article", title: "Article" }],
  }) }] });
  assert.deepEqual(readSources(result), {
    sources: [{ url: "https://example.com/article", title: "Article" }], failed: false, recognized: true,
  });
});
test("keeps the structural depth limit for nested and cyclic content", () => {
  let result: unknown = { results: [{ url: "https://example.com/article" }] };
  for (let depth = 0; depth < 7; depth++) result = { content: result };
  assert.deepEqual(readSources(result), { sources: [], failed: false, recognized: false });
  const cycle: { content?: unknown } = {};
  cycle.content = cycle;
  assert.deepEqual(readSources(cycle), { sources: [], failed: false, recognized: false });
});
test("rejects unsafe or malformed links while preserving valid partial results", () => {
  assert.deepEqual(readSources({ results: [
    { url: "javascript:alert(1)" }, { url: "file:///etc/passwd" },
    { url: "https://secret:password@example.com/" }, { url: "not a URL" },
    { url: "https://example.com/page" },
  ], errors: [{ message: "One page unavailable" }] }), {
    sources: [{ url: "https://example.com/page", title: "example.com" }], failed: true, recognized: true,
  });
});
test("handles malformed text, empty results and MCP tool errors", () => {
  assert.deepEqual(readSources("not JSON"), { sources: [], failed: false, recognized: false });
  assert.deepEqual(readSources({ isError: true, content: [{ type: "text", text: "Rate limited" }] }), { sources: [], failed: true, recognized: true });
});
test("starts without credentials and only sets a Bearer header when configured", () => {
  assert.deepEqual(parallelServer("  "), { type: "http", url: "https://search.parallel.ai/mcp" });
  assert.deepEqual(parallelServer(" test-key ").options?.requestInit?.headers, { Authorization: "Bearer test-key" });
});
