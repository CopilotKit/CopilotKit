// Drive one chat run through the quickstart's FastAPI-tab runtime route shape:
// CopilotRuntime + HttpAgent + createCopilotRuntimeHandler in single-route
// mode, from the published CopilotKit 1.73.3 packages installed in the
// LangGraph Python Showcase (@ag-ui/client 0.0.59). The intelligence and
// identifyUser options are dropped, which the guide's "Running without the
// Intelligence Platform?" callout documents as the SSE fallback.
//
// Usage: node lgp-byoc-fastapi-run.mjs <node_modules dir> <agent url>
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [nodeModules, agentUrl] = process.argv.slice(2);
const load = (p) => import(pathToFileURL(path.join(nodeModules, p)).href);
const { CopilotRuntime, createCopilotRuntimeHandler } = await load(
  "@copilotkit/runtime/dist/v2/index.mjs",
);
const { HttpAgent } = await load("@ag-ui/client/dist/index.mjs");

const runtime = new CopilotRuntime({
  agents: { sample_agent: new HttpAgent({ url: agentUrl }) },
});
const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  mode: "single-route",
});

const res = await handler(
  new Request("http://localhost/api/copilotkit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      method: "agent/run",
      params: { agentId: "sample_agent" },
      body: {
        threadId: randomUUID(),
        runId: randomUUID(),
        state: {},
        messages: [
          {
            id: randomUUID(),
            role: "user",
            content: "Can you tell me a joke?",
          },
        ],
        tools: [],
        context: [],
        forwardedProps: {},
      },
    }),
  }),
);
console.log("runtime HTTP", res.status);
const text = await res.text();
const events = text
  .split("\n")
  .filter((l) => l.startsWith("data:"))
  .map((l) => JSON.parse(l.slice(5)));
console.log("event types:", events.map((e) => e.type).join(" "));
const reply = events
  .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
  .map((e) => e.delta)
  .join("");
console.log("assistant text:", JSON.stringify(reply));
const error = events.find((e) => e.type === "RUN_ERROR");
if (error) console.log("RUN_ERROR:", JSON.stringify(error).slice(0, 600));
const finished = events.some((e) => e.type === "RUN_FINISHED");
console.log(finished && !error ? "RESULT: RUN_FINISHED" : "RESULT: FAILED");
process.exit(finished && !error ? 0 : 1);
