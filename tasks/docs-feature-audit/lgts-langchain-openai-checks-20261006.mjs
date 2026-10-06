// Explicit checks of two @langchain/openai behaviours that caused the
// 2026-09-23 LangGraph TypeScript failures (lgts-mcp-apps-20260923.md and
// lgts-runtime-matrix-20260923b.md), re-run against the agent's installed
// @langchain/openai / @langchain/core (1.6.2 / 1.2.14 after the 2026-10-06
// update) and Showcase's pinned aimock (1.37.4).
//
// 1. Role-less first Chat Completions delta: what type does the aggregated
//    message get, and where does a streamed tool call end up?
// 2. System prompts: which role (`system` or `developer`) does ChatOpenAI send
//    for gpt-5* and non-reasoning models, and does strict aimock 1.37.4's
//    `systemMessage` matcher see that role on /v1/chat/completions?
//
// usage: node lgts-langchain-openai-checks-20261006.mjs <worktree-root>
import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";

const root = process.argv[2];
const agentNM = path.join(
  root,
  "showcase/integrations/langgraph-typescript/src/agent/node_modules",
);
const aimockDir = path.join(
  root,
  "showcase/scripts/node_modules/@copilotkit/aimock",
);
const version = async (dir) =>
  JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")).version;
const { ChatOpenAI } = await import(
  path.join(agentNM, "@langchain/openai/dist/index.js")
);
const { HumanMessage, SystemMessage } = await import(
  path.join(agentNM, "@langchain/core/dist/messages/index.js")
);
const aimock = await import(path.join(aimockDir, "dist/index.js"));
console.log(
  JSON.stringify({
    "@langchain/openai": await version(path.join(agentNM, "@langchain/openai")),
    "@langchain/core": await version(path.join(agentNM, "@langchain/core")),
    openai: await version(path.join(agentNM, "openai")),
    "@copilotkit/aimock": await version(aimockDir),
  }),
);

// ---------------------------------------------------------------- check 1
const content =
  "Sketching a client -> server -> database diagram in Excalidraw.";
const toolCalls = [
  {
    id: "call_repro_create_view_001",
    name: "create_view",
    arguments: JSON.stringify({ elements: [{ id: "b1", type: "rectangle" }] }),
  },
];
const reasoning = "The user wants a sketch. I'll call create_view once.";
const variants = {
  "aimock-1.37.4 content+tool+reasoning (role-less first delta)": () =>
    aimock.buildContentWithToolCallsChunks(
      content,
      toolCalls,
      "gpt-5-mini",
      8,
      reasoning,
    ),
  "aimock-1.37.4 tool-only+reasoning (role-less first delta)": () =>
    aimock.buildToolCallChunks(toolCalls, "gpt-5-mini", 8, reasoning),
  "aimock-1.37.4 text-only+reasoning (role-less first delta)": () =>
    aimock.buildTextChunks(content, "gpt-5-mini", 8, reasoning),
  "content+tool, no reasoning (role on first delta)": () =>
    aimock.buildContentWithToolCallsChunks(
      content,
      toolCalls,
      "gpt-5-mini",
      8,
      undefined,
    ),
};
let current;
let lastBody;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    lastBody = JSON.parse(body);
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const chunk of current())
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const baseURL = `http://127.0.0.1:${server.address().port}/v1`;
const tool = {
  type: "function",
  function: {
    name: "create_view",
    description: "draw",
    parameters: { type: "object", properties: {} },
  },
};
console.log("# check 1: role-less first delta -> aggregated message type");
for (const [name, build] of Object.entries(variants)) {
  current = build;
  const firstDelta = build()[0].choices[0].delta;
  const model = new ChatOpenAI({
    model: "gpt-5-mini",
    apiKey: "sk-mock",
    configuration: { baseURL },
  }).bindTools([tool]);
  let firstStreamType;
  let end;
  for await (const ev of model.streamEvents([new HumanMessage("sketch")], {
    version: "v2",
  })) {
    if (ev.event === "on_chat_model_stream" && firstStreamType === undefined)
      firstStreamType = ev.data.chunk._getType();
    if (ev.event === "on_chat_model_end") end = ev.data.output;
  }
  console.log(
    JSON.stringify({
      variant: name,
      firstDeltaKeys: Object.keys(firstDelta),
      firstStreamChunkType: firstStreamType,
      endType: end._getType(),
      tool_calls: end.tool_calls?.map((t) => t.name) ?? null,
      additional_kwargs_tool_calls:
        end.additional_kwargs?.tool_calls?.map((t) => t.function.name) ?? null,
      contentChars:
        typeof end.content === "string"
          ? end.content.length
          : JSON.stringify(end.content).length,
    }),
  );
}

// ---------------------------------------------------------------- check 2
console.log("# check 2: role ChatOpenAI sends for a SystemMessage");
current = () => aimock.buildTextChunks("ok", "x", 8, undefined);
for (const model of ["gpt-5-mini", "gpt-5.4", "gpt-4o-mini", "gpt-4.1"]) {
  // streaming: true because the stub server always answers with SSE (the
  // agents stream too, under LangGraph's events stream mode).
  await new ChatOpenAI({
    model,
    apiKey: "sk-mock",
    streaming: true,
    configuration: { baseURL },
  }).invoke([
    new SystemMessage("Recipe: Lemon Saffron Orzo"),
    new HumanMessage("hi"),
  ]);
  console.log(
    JSON.stringify({
      model,
      roles: lastBody.messages.map((m) => m.role),
    }),
  );
}
server.close();

console.log(
  "# check 2b: strict aimock 1.37.4 systemMessage matcher on /v1/chat/completions",
);
const gated = await aimock.createServer(
  [
    {
      match: { systemMessage: "Lemon Saffron Orzo", userMessage: "hi" },
      response: { content: "gated-match" },
    },
  ],
  { port: 0, host: "127.0.0.1", strict: true, logLevel: "silent" },
);
for (const role of ["system", "developer"]) {
  const res = await fetch(`${gated.url}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5-mini",
      messages: [
        { role, content: "Recipe: Lemon Saffron Orzo" },
        { role: "user", content: "hi" },
      ],
    }),
  });
  console.log(JSON.stringify({ role, status: res.status }));
}
await new Promise((r) =>
  gated.server ? gated.server.close(r) : gated.close ? gated.close(r) : r(),
);
process.exit(0);
