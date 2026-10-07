// Drive one chat run through the AWS Strands quickstart's own runtime route
// file. adk-byoc-runtime-run.mts with the agent id as an argument (the Strands
// guide registers `strands_agent`).
//
// Imports the route module written from the guide's
// `app/api/copilotkit/[[...slug]]/route.ts` block (with the "Running without
// the Intelligence Platform?" callout applied: no `intelligence`, no
// `identifyUser`) and calls its exported handlers the way the guide's
// provider does (`runtimeUrl="/api/copilotkit"`, `useSingleEndpoint={false}`,
// `agent="<agentId>"`): GET /api/copilotkit/info, then
// POST /api/copilotkit/agent/<agentId>/run with an AG-UI RunAgentInput.
// Module resolution starts at the route file, so the packages are the ones the
// guide's `npm install` step put in that frontend's node_modules.
//
// Usage: tsx strands-byoc-runtime-run.mts <route.ts> <agentId> [prompt]
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [routeFile, agentId, prompt = "Please tell me a joke."] =
  process.argv.slice(2);
if (!routeFile || !agentId)
  throw new Error("usage: strands-byoc-runtime-run.mts <route.ts> <agentId>");
const route = await import(pathToFileURL(path.resolve(routeFile)).href);
const base = "http://localhost:3000/api/copilotkit";

const info = await route.GET(new Request(`${base}/info`));
const infoBody = await info.text();
let agents: string[] = [];
try {
  agents = Object.keys(JSON.parse(infoBody).agents ?? {});
} catch {
  /* reported below */
}
console.log(
  "GET /api/copilotkit/info ->",
  info.status,
  "agents:",
  agents.join(",") || infoBody.slice(0, 200),
);

const res = await route.POST(
  new Request(`${base}/agent/${agentId}/run`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({
      threadId: randomUUID(),
      runId: randomUUID(),
      state: {},
      messages: [{ id: randomUUID(), role: "user", content: prompt }],
      tools: [],
      context: [],
      forwardedProps: {},
    }),
  }),
);
console.log(`POST /api/copilotkit/agent/${agentId}/run ->`, res.status);
const text = await res.text();
const events = text
  .split("\n")
  .filter((l) => l.startsWith("data:"))
  .map((l) => JSON.parse(l.slice(5)));
console.log("event types:", events.map((e) => e.type).join(" ") || text.slice(0, 300));
const reply = events
  .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
  .map((e) => e.delta)
  .join("");
console.log("assistant text:", JSON.stringify(reply));
const error = events.find((e) => e.type === "RUN_ERROR");
if (error) console.log("RUN_ERROR:", JSON.stringify(error).slice(0, 600));
const finished = events.some((e) => e.type === "RUN_FINISHED");
const ok = info.status === 200 && agents.includes(agentId) && finished && !error;
console.log(ok ? "RESULT: RUN_FINISHED" : "RESULT: FAILED");
process.exit(ok ? 0 : 1);
