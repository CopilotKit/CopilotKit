// REPAIR-041 two-turn check: does the Built-in Agent subagents demo's
// delegation log survive a second run in the same thread?
//
// Drives the running stack (port 3117) with @ag-ui/client's HttpAgent, the
// same client class the CopilotKit frontend uses: it keeps agent.state
// across runs, sends it as RunAgentInput.state on the next run, and applies
// STATE_SNAPSHOT / STATE_DELTA events to it. Two user turns go to the
// `subagents` agent on /api/copilotkit; the scratch AIMock fixtures
// (bia-subagents-two-turn-fixtures-20261006.json) make turn 1 delegate once
// to research_agent and turn 2 once to writing_agent.
//
// PASS: after turn 2, agent.state.delegations holds both entries, in order.
// usage: node bia-subagents-two-turn.mjs [base-url]
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const BIA = new URL(
  "../../showcase/integrations/built-in-agent/package.json",
  import.meta.url,
);
const require = createRequire(BIA);
const { HttpAgent } = require("@ag-ui/client");
const clientVersion = require("@ag-ui/client/package.json").version;

const base = process.argv[2] ?? "http://localhost:3117";
const agent = new HttpAgent({
  url: `${base}/api/copilotkit/agent/subagents/run`,
  headers: {
    "x-aimock-context": "built-in-agent",
    "x-test-id": `bia-subagents-two-turn-${Date.now()}`,
  },
  threadId: randomUUID(),
});

const summarize = (delegations) =>
  (delegations ?? []).map((d) => `${d.sub_agent}("${d.task}")`).join(", ") ||
  "(none)";

async function turn(n, prompt) {
  const sentState = JSON.parse(JSON.stringify(agent.state ?? {}));
  agent.addMessage({ id: randomUUID(), role: "user", content: prompt });
  const events = [];
  await agent.runAgent(
    { runId: randomUUID() },
    {
      onEvent: ({ event }) => {
        events.push(event);
      },
    },
  );
  const deltas = events.filter((e) => e.type === "STATE_DELTA");
  console.log(`## turn ${n}: "${prompt}"`);
  console.log(
    `   RunAgentInput.state sent: delegations = ${summarize(sentState.delegations)}`,
  );
  console.log(`   events: ${events.map((e) => e.type).join(" ")}`);
  for (const d of deltas)
    console.log(
      `   STATE_DELTA ${JSON.stringify(d.delta.map((op) => ({ op: op.op, path: op.path, value: Array.isArray(op.value) ? summarize(op.value) : op.value })))}`,
    );
  console.log(
    `   agent.state.delegations after the run: ${summarize(agent.state?.delegations)}`,
  );
  return agent.state?.delegations ?? [];
}

console.log(
  `# REPAIR-041 two-turn delegation-log check, ${new Date().toISOString()}, @ag-ui/client ${clientVersion}, ${base}, threadId ${agent.threadId}`,
);
const after1 = await turn(1, "Delegation log check one");
const after2 = await turn(2, "Delegation log check two");
const names = after2.map((d) => d.sub_agent);
const pass =
  after1.length === 1 &&
  names.length === 2 &&
  names[0] === "research_agent" &&
  names[1] === "writing_agent";
console.log(
  pass
    ? "RESULT: PASS - the turn-1 delegation is still in the log after turn 2."
    : `RESULT: FAIL - expected [research_agent, writing_agent] after turn 2, got [${names.join(", ")}].`,
);
process.exitCode = pass ? 0 : 1;
