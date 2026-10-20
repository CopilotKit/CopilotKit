const agentUrl = process.env.AGENT_URL ?? "http://agent:8000/";
const response = await fetch(agentUrl, {
  method: "POST",
  signal: AbortSignal.timeout(60_000),
  headers: {
    accept: "text/event-stream",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    threadId: "smoke-thread",
    runId: "smoke-run",
    state: { proverbs: [] },
    messages: [{ id: "user-1", role: "user", content: "Hello" }],
    tools: [],
    context: [],
    forwardedProps: {},
  }),
});

if (!response.ok) {
  throw new Error(
    `Agent returned HTTP ${response.status}: ${await response.text()}`,
  );
}

const events = await response.text();
for (const expected of [
  '"type":"TEXT_MESSAGE_CONTENT"',
  "The CrewAI Flows assistant is ready.",
  '"type":"RUN_FINISHED"',
]) {
  if (!events.includes(expected)) {
    throw new Error(`Agent stream did not contain ${expected}:\n${events}`);
  }
}

const terminalEvents = events.match(/"type":"RUN_(?:FINISHED|ERROR)"/g) ?? [];
if (terminalEvents.length !== 1) {
  throw new Error(
    `Expected exactly one terminal event, received ${terminalEvents.length}:\n${events}`,
  );
}
