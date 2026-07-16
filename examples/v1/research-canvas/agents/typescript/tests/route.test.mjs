import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const agentSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/agent.ts"),
  "utf8",
);

test("route handles non-specialized tool calls without ending the graph", () => {
  assert.match(agentSource, /const toolName = aiMessage\.tool_calls\?\.\[0\]\?\.name;/);
  assert.match(agentSource, /if \(toolName === "Search"\)/);
  assert.match(agentSource, /else if \(toolName === "DeleteResources"\)/);
  assert.match(agentSource, /else if \(toolName\) \{\s*return "chat_node";\s*\}/);
});

test("route no longer depends on streamed AIMessageChunk constructor names", () => {
  assert.doesNotMatch(agentSource, /AIMessageChunk/);
});
