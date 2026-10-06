// Drive one chat run through the LangGraph quickstart's own runtime route
// file (TypeScript reader, LangSmith tab).
//
// Imports the route module written from the guide's
// `app/api/copilotkit/route.ts` block (with the "Running without the
// Intelligence Platform?" callout applied: no `intelligence`, no
// `identifyUser`) and calls its exported POST handler the way the guide's
// provider does (`runtimeUrl="/api/copilotkit"`, `useSingleEndpoint`,
// `agent="sample_agent"`): the single-route envelopes `{ method: "info" }`
// and `{ method: "agent/run", params: { agentId }, body: RunAgentInput }`.
// Module resolution starts at the route file, so the packages are the ones the
// guide's `npm install` step put in that frontend's node_modules.
// Modelled on adk-byoc-runtime-run.mts (which drives a multi-route handler).
//
// Usage: tsx lgts-byoc-runtime-run.mts <route.ts> <agentId> [prompt]
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [routeFile, agentId, prompt = "Can you tell me a joke?"] =
  process.argv.slice(2);
if (!routeFile || !agentId)
  throw new Error("usage: lgts-byoc-runtime-run.mts <route.ts> <agentId>");
const route = await import(pathToFileURL(path.resolve(routeFile)).href);
const url = "http://localhost:3000/api/copilotkit";
const post = (envelope: unknown) =>
  route.POST(
    new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify(envelope),
    }),
  );

const info = await post({ method: "info" });
const infoBody = await info.text();
let agents: string[] = [];
let version = "?";
try {
  const parsed = JSON.parse(infoBody);
  agents = Object.keys(parsed.agents ?? {});
  version = parsed.version;
} catch {
  /* reported below */
}
console.log(
  'POST /api/copilotkit {method:"info"} ->',
  info.status,
  "runtime",
  version,
  "agents:",
  agents.join(",") || infoBody.slice(0, 200),
);

const threadId = randomUUID();
const res = await post({
  method: "agent/run",
  params: { agentId },
  body: {
    threadId,
    runId: randomUUID(),
    state: {},
    messages: [{ id: randomUUID(), role: "user", content: prompt }],
    tools: [],
    context: [],
    forwardedProps: {},
  },
});
console.log(
  `POST /api/copilotkit {method:"agent/run", agentId:"${agentId}"} ->`,
  res.status,
);
const text = await res.text();
const events = text
  .split("\n")
  .filter((l) => l.startsWith("data:"))
  .map((l) => JSON.parse(l.slice(5)));
console.log(
  "event types:",
  events.map((e) => e.type).join(" ") || text.slice(0, 300),
);
const reply = events
  .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
  .map((e) => e.delta)
  .join("");
console.log("assistant text:", JSON.stringify(reply));
const error = events.find((e) => e.type === "RUN_ERROR");
if (error) console.log("RUN_ERROR:", JSON.stringify(error).slice(0, 600));
const finished = events.some((e) => e.type === "RUN_FINISHED");
const ok =
  info.status === 200 &&
  agents.includes(agentId) &&
  finished &&
  !error &&
  reply.length > 0;
console.log(ok ? "RESULT: RUN_FINISHED" : "RESULT: FAILED");
process.exit(ok ? 0 : 1);
