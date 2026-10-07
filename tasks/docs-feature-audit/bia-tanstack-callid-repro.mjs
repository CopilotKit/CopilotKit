// Minimal repro: which id does @tanstack/ai-openai's Responses adapter give a
// function call, and send back with its result?
//
// The OpenAI Responses API streams a function call as an output item with two
// ids: `id` (the item id, "fc_...") and `call_id` (the tool-call id the model
// chose, which `function_call_output.call_id` must echo). This script runs one
// TanStack `chat()` with a single server tool against a scratch strict AIMock
// whose first fixture answers with tool call id "call_repro_1" and whose
// second fixture only matches a follow-up whose tool result carries
// call_id "call_repro_1".
//   correct adapter: TOOL_CALL_START.toolCallId = call_repro_1, request 2
//                    matches the follow-up, the run ends with its text;
//   item-id adapter: toolCallId = the AIMock item id ("fc-..."), request 2
//                    falls back to the first fixture, and the loop repeats
//                    the tool call until maxIterations stops it.
// Uses the Built-in Agent's installed @tanstack/ai and @tanstack/ai-openai.
// usage: [BIA_DIR=<install>] node bia-tanstack-callid-repro.mjs <aimock-base-url>   (e.g. http://127.0.0.1:4411)
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// BIA_DIR points at another install of the integration (e.g. a scratch copy).
const BIA = process.env.BIA_DIR
  ? pathToFileURL(`${process.env.BIA_DIR.replace(/\/$/, "")}/`)
  : new URL("../../showcase/integrations/built-in-agent/", import.meta.url);
const require = createRequire(new URL("package.json", BIA));
const pkg = (spec) =>
  JSON.parse(
    readFileSync(new URL(`node_modules/${spec}/package.json`, BIA), "utf8"),
  );
const resolveEsm = (spec) =>
  new URL(
    `node_modules/${spec}/${pkg(spec).exports["."].import.replace(/^\.\//, "")}`,
    BIA,
  ).href;
const versions = Object.fromEntries(
  ["@tanstack/ai", "@tanstack/ai-openai", "@tanstack/openai-base"].map((p) => [
    p,
    pkg(p).version,
  ]),
);
const { chat, toolDefinition, maxIterations } = await import(
  resolveEsm("@tanstack/ai")
);
const { openaiText } = await import(resolveEsm("@tanstack/ai-openai"));
const { z } = require("zod");

const base = process.argv[2] ?? "http://127.0.0.1:4411";
process.env.OPENAI_API_KEY ??= "sk-mock";
process.env.OPENAI_BASE_URL = `${base}/v1`;

const echo = toolDefinition({
  name: "echo_tool",
  description: "Echo a fixed value.",
  inputSchema: z.object({}),
}).server(async () => ({ ok: true }));

console.log(
  `# @tanstack/openai-base call_id repro, ${new Date().toISOString()}, ${JSON.stringify(versions)}, AIMock ${base}`,
);
await fetch(`${base}/__aimock/reset/journal`, { method: "POST" });
const starts = [];
let text = "";
for await (const chunk of chat({
  adapter: openaiText("gpt-5.4"),
  messages: [{ role: "user", content: "callid repro: call the echo tool" }],
  tools: [echo],
  agentLoopStrategy: maxIterations(3),
})) {
  if (chunk.type === "TOOL_CALL_START") starts.push(chunk.toolCallId);
  if (chunk.type === "TEXT_MESSAGE_CONTENT") text += chunk.delta ?? "";
}
console.log(`TOOL_CALL_START toolCallIds: ${starts.join(", ")}`);
console.log(`assistant text: ${JSON.stringify(text)}`);
const journal = await (await fetch(`${base}/__aimock/journal`)).json();
journal.forEach((e, i) => {
  const msgs = e.body?.messages ?? [];
  const last = msgs[msgs.length - 1] ?? {};
  console.log(
    `request ${i + 1}: last message role=${last.role}${last.tool_call_id ? ` tool_call_id=${last.tool_call_id}` : ""} -> fixture ${JSON.stringify(e.response?.fixture?.match ?? null)}`,
  );
});
const pass =
  starts[0] === "call_repro_1" && text.includes("matched by call_id");
console.log(
  pass
    ? "RESULT: PASS - the tool result echoed the model's call_id."
    : "RESULT: FAIL - the tool result did not echo the model's call_id.",
);
process.exitCode = pass ? 0 : 1;
