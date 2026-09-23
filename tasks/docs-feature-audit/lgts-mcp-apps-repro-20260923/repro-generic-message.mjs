// Minimal repro: a Chat Completions stream whose first delta has no `role`
// makes @langchain/openai (JS) aggregate a "generic" ChatMessageChunk whose
// tool call survives only in additional_kwargs.tool_calls.
//
// Uses the exact packages the LGTS agent resolves (@langchain/openai 1.5.13,
// @langchain/core 1.2.12) and the AIMock build Showcase's local runner pins
// (@copilotkit/aimock 1.37.4), with the real LGTS create_view fixture shape.
//
// usage: node repro-generic-message.mjs <worktree-root>
import http from "node:http";
import path from "node:path";

const root = process.argv[2];
const agentNM = path.join(
  root,
  "showcase/integrations/langgraph-typescript/src/agent/node_modules",
);
const aimockDir = path.join(
  root,
  "showcase/scripts/node_modules/@copilotkit/aimock",
);
const { ChatOpenAI } = await import(
  path.join(agentNM, "@langchain/openai/dist/index.js")
);
const { HumanMessage } = await import(
  path.join(agentNM, "@langchain/core/dist/messages/index.js")
);
const aimock = await import(path.join(aimockDir, "dist/index.js"));
const aimockVersion = JSON.parse(
  await (
    await import("node:fs/promises")
  ).readFile(path.join(aimockDir, "package.json"), "utf8"),
).version;

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

// Variant shapes, each built by AIMock's own exported chunk builders.
const variants = {
  // What aimock 1.37.4 streams for this fixture when the request model is
  // reasoning-capable (gpt-5-mini): reasoning_content deltas BEFORE the role delta.
  "aimock-1.37.4 content+tool+reasoning (gpt-5-mini)": () =>
    aimock.buildContentWithToolCallsChunks(
      content,
      toolCalls,
      "gpt-5-mini",
      8,
      reasoning,
    ),
  // Same fixture, no reasoning channel (what strict aimock emits for gpt-4o-mini,
  // and what OpenAI Chat Completions streams for gpt-5 models).
  "no reasoning channel": () =>
    aimock.buildContentWithToolCallsChunks(
      content,
      toolCalls,
      "gpt-5-mini",
      8,
      undefined,
    ),
  // aimock >= 1.43.0 (CopilotKit/aimock 16646fa255): role rides on the first reasoning delta.
  "role on first delta (aimock 1.43.0 shape)": () => {
    const chunks = aimock.buildContentWithToolCallsChunks(
      content,
      toolCalls,
      "gpt-5-mini",
      8,
      reasoning,
    );
    chunks[0].choices[0].delta = {
      role: "assistant",
      ...chunks[0].choices[0].delta,
    };
    return chunks;
  },
  // Tool-only + reasoning: still reasoning-first/role-less in aimock 1.43.0 (buildToolCallChunks).
  "aimock tool-only+reasoning (unfixed in 1.43.0)": () =>
    aimock.buildToolCallChunks(toolCalls, "gpt-5-mini", 8, reasoning),
};

let current;
const server = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const chunk of current())
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const baseURL = `http://127.0.0.1:${server.address().port}/v1`;

console.log(
  `@copilotkit/aimock ${aimockVersion}; @langchain/openai ${JSON.parse(await (await import("node:fs/promises")).readFile(path.join(agentNM, "@langchain/openai/package.json"), "utf8")).version}`,
);
for (const [name, build] of Object.entries(variants)) {
  current = build;
  const firstDelta = build()[0].choices[0].delta;
  const model = new ChatOpenAI({
    model: "gpt-5-mini",
    apiKey: "sk-mock",
    configuration: { baseURL },
  }).bindTools([
    {
      type: "function",
      function: {
        name: "create_view",
        description: "draw",
        parameters: { type: "object", properties: {} },
      },
    },
  ]);
  // streamEvents drives the same _streamResponseChunks + concat aggregation that
  // an `invoke` inside a LangGraph node uses under the events stream mode.
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
    }),
  );
}
server.close();
