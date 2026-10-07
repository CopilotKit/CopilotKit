// Drive the Strands native-interrupt agent (gen-ui-interrupt -> AGENT_URL/interrupt/)
// through the running showcase runtime (/api/copilotkit, single-route envelope),
// to check the HITL guide's claims on the wire: the pause ends the run with
// RUN_FINISHED outcome.type "interrupt"; a resume on the same thread with an
// AG-UI 1.0 `resume` entry continues the same tool call, which sees the answer
// wrapped as {"response": ...} (resolved) or {"cancelled": true} (cancelled).
// Forwards x-aimock-context/strict and x-test-id so strict AIMock serves the
// shipped gen-ui-interrupt fixtures.
// usage: node strands-interrupt-probe.mjs [baseUrl]
import { randomUUID } from "node:crypto";
const base = process.argv[2] ?? "http://localhost:3112";
const headers = {
  "content-type": "application/json",
  accept: "text/event-stream",
  "x-aimock-context": "strands",
  "x-aimock-strict": "true",
  "x-test-id": `interrupt-probe-${Date.now()}`,
};
async function run(agentId, body) {
  const res = await fetch(`${base}/api/copilotkit`, {
    method: "POST",
    headers,
    body: JSON.stringify({ method: "agent/run", params: { agentId }, body }),
  });
  const text = await res.text();
  const events = text
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => JSON.parse(l.slice(5)));
  return { status: res.status, events };
}
const show = (label, r) => {
  console.log(`## ${label}: HTTP ${r.status}`);
  console.log("  events:", r.events.map((e) => e.type).join(" "));
  for (const e of r.events) {
    if (e.type === "TOOL_CALL_START")
      console.log("  TOOL_CALL_START", e.toolCallName, e.toolCallId);
    if (e.type === "TOOL_CALL_RESULT")
      console.log("  TOOL_CALL_RESULT", JSON.stringify(e.content));
    if (e.type === "RUN_ERROR") console.log("  RUN_ERROR", e.message);
    if (e.type === "RUN_FINISHED")
      console.log("  RUN_FINISHED outcome:", JSON.stringify(e.outcome ?? null));
  }
  const text = r.events
    .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
    .map((e) => e.delta)
    .join("");
  console.log("  assistant text:", JSON.stringify(text));
  return r.events.find((e) => e.type === "RUN_FINISHED")?.outcome;
};
let failed = false;
for (const [label, prompt, answer] of [
  [
    "resolved",
    "Book an intro call with the sales team to discuss pricing.",
    {
      status: "resolved",
      payload: {
        chosen_time: "2026-10-08T10:00",
        chosen_label: "Thu 10:00 AM",
      },
    },
  ],
  [
    "cancelled",
    "Book an intro call with the sales team to discuss pricing.",
    { status: "cancelled" },
  ],
]) {
  const threadId = randomUUID();
  const messages = [{ id: randomUUID(), role: "user", content: prompt }];
  const first = await run("gen-ui-interrupt", {
    threadId,
    runId: randomUUID(),
    state: {},
    messages,
    tools: [],
    context: [],
    forwardedProps: {},
  });
  const outcome = show(`${label}: run 1 (pause)`, first);
  const intr = outcome?.interrupts?.[0];
  if (outcome?.type !== "interrupt" || !intr) {
    failed = true;
    console.log("  EXPECTED outcome.type interrupt");
    continue;
  }
  console.log("  interrupt:", JSON.stringify(intr));
  const second = await run("gen-ui-interrupt", {
    threadId,
    runId: randomUUID(),
    state: {},
    messages,
    tools: [],
    context: [],
    forwardedProps: {},
    resume: [{ interruptId: intr.id, ...answer }],
  });
  const o2 = show(`${label}: run 2 (resume ${JSON.stringify(answer)})`, second);
  const result =
    second.events.find((e) => e.type === "TOOL_CALL_RESULT")?.content ?? "";
  const want =
    label === "resolved"
      ? "Meeting scheduled for Thu 10:00 AM"
      : "User cancelled";
  const ok = o2?.type === "success" && String(result).includes(want);
  console.log(
    `  RESULT ${label}: ${ok ? "PASS" : "FAIL"} (tool result must contain "${want}")`,
  );
  failed ||= !ok;
}
process.exit(failed ? 1 : 0);
