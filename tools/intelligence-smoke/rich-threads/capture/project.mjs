import assert from "node:assert/strict";

/** Reconstruct the source with the public AG-UI consumer, never the destination
 * transcript reducer. Package identities belong in the baseline manifest.
 */
export async function projectEvents({ events, AbstractAgent, from }) {
  assert.ok(events.length, "No source events to reconstruct");
  const groups = new Map();
  for (const event of events) {
    assert.ok(event.runId, "Unowned source event");
    if (!groups.has(event.runId)) groups.set(event.runId, []);
    groups.get(event.runId).push(event);
  }
  let state = {};
  let messages = [];
  let pending = [];
  for (const [runId, runEvents] of groups) {
    const start = runEvents.find((event) => event.type === "RUN_STARTED");
    assert.ok(start?.input, "Canonical RUN_STARTED input required");
    class Replay extends AbstractAgent {
      run() {
        return from(structuredClone(runEvents));
      }
    }
    const agent = new Replay({
      threadId: start.threadId,
      initialMessages: structuredClone(start.input.messages),
      initialState: structuredClone(start.input.state ?? state),
    });
    let streamError;
    try {
      await agent.runAgent({
        runId,
        tools: start.input.tools ?? [],
        context: start.input.context ?? [],
        forwardedProps: start.input.forwardedProps ?? {},
      });
    } catch (error) {
      streamError = error;
    }
    if (streamError && !runEvents.some((event) => event.type === "RUN_ERROR"))
      throw streamError;
    messages = structuredClone(agent.messages);
    state = structuredClone(agent.state);
    const terminal = runEvents.findLast(
      (event) => event.type === "RUN_FINISHED" || event.type === "RUN_ERROR",
    );
    assert.ok(terminal, "Captured run has not reached a terminal event");
    pending = terminal.outcome?.interrupts ?? terminal.interrupts ?? [];
  }
  // The Intelligence transcript uses name/args, the public AG-UI client uses
  // type/function. Only this documented representation difference is adapted.
  const transcript = messages.map((message) => ({
    ...message,
    ...(message.toolCalls
      ? {
          toolCalls: message.toolCalls.map((call) => ({
            id: call.id,
            name: call.function.name,
            args: call.function.arguments,
          })),
        }
      : {}),
  }));
  return { messages: transcript, state, pending };
}
