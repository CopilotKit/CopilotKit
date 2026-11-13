/**
 * Exercise a real AG-UI backend and verify that its final authoritative snapshot
 * retains every streamed backend call/result, including calls that update state.
 *
 * Run the SAME probe against any integration exposing the shared showcase tools:
 *   pnpm nx run @copilotkit/showcase-scripts:probe-backend-tool-history -- \
 *     http://127.0.0.1:8000/beautiful_chat /tmp/tool-history-evidence
 * Requires the backend's configured model (live or aimock); no SDK stubs.
 * Evidence contains synthetic test conversations only. Exit nonzero on loss.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [endpoint, outputDirectory] = process.argv.slice(2);
assert(
  endpoint && outputDirectory,
  "Pass an AG-UI endpoint and evidence directory",
);
await mkdir(outputDirectory, { recursive: true });

const cases = [
  {
    name: "sales-state",
    tool: "manage_sales_todos",
    prompt:
      "Call manage_sales_todos exactly once. Set the complete list to three sales todos: title Cedar, stage prospect, value 100, assignee Ava; title Maple, stage lead, value 200, assignee Ben; title Oak, stage negotiation, value 300, assignee Cam. Then tell me the three names.",
    stateKey: "todos",
  },
  {
    name: "ordinary-tool",
    tool: "query_data",
    prompt:
      "Call query_data exactly once to retrieve sales data, then summarize it in one short sentence. Do not call any other tool.",
  },
  {
    name: "notes-state",
    tool: "set_notes",
    prompt:
      "Call set_notes exactly once to remember that my favorite color is blue. Then confirm in one sentence. Do not call any other tool.",
    stateKey: "notes",
  },
];

let failures = 0;
for (const scenario of cases) {
  const threadId = randomUUID();
  const input = {
    threadId,
    runId: randomUUID(),
    messages: [{ id: randomUUID(), role: "user", content: scenario.prompt }],
    state: {},
    tools: [],
    context: [],
    forwardedProps: {},
  };
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(120_000),
    });
    assert.equal(response.status, 200, `AG-UI HTTP status: ${response.status}`);
    const wire = await response.text();
    const events = wire.split(/\r?\n\r?\n/).flatMap((frame) => {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      return data && data !== "[DONE]" ? [JSON.parse(data)] : [];
    });
    await writeFile(
      join(outputDirectory, `${scenario.name}.json`),
      JSON.stringify({ endpoint, input, events }, null, 2),
    );
    assert(
      !events.some((event) => event.type === "RUN_ERROR"),
      "Run emitted RUN_ERROR",
    );
    assert(
      events.some((event) => event.type === "RUN_FINISHED"),
      "Run did not finish",
    );
    const messages = events.findLast(
      (event) => event.type === "MESSAGES_SNAPSHOT",
    )?.messages;
    assert(Array.isArray(messages), "No final messages snapshot");
    const starts = events.filter((event) => event.type === "TOOL_CALL_START");
    assert(
      starts.some((event) => event.toolCallName === scenario.tool),
      `Model did not call ${scenario.tool}`,
    );
    for (const start of starts) {
      const args = events
        .filter(
          (event) =>
            event.type === "TOOL_CALL_ARGS" &&
            event.toolCallId === start.toolCallId,
        )
        .map((event) => event.delta)
        .join("");
      const owners = messages.filter((message) =>
        message.toolCalls?.some((call) => call.id === start.toolCallId),
      );
      assert.equal(
        owners.length,
        1,
        `${start.toolCallName}: expected exactly one assistant owner`,
      );
      const owner = owners[0];
      assert.equal(owner.role, "assistant");
      if (start.parentMessageId) assert.equal(owner.id, start.parentMessageId);
      const calls = owner.toolCalls.filter(
        (call) => call.id === start.toolCallId,
      );
      assert.equal(calls.length, 1, "Duplicate tool call");
      assert.equal(calls[0].function.name, start.toolCallName);
      assert.deepEqual(
        JSON.parse(calls[0].function.arguments),
        JSON.parse(args),
      );
      const result = events.find(
        (event) =>
          event.type === "TOOL_CALL_RESULT" &&
          event.toolCallId === start.toolCallId,
      );
      assert(result, "Backend call did not produce a result");
      const savedResults = messages.filter(
        (message) =>
          message.role === "tool" && message.toolCallId === start.toolCallId,
      );
      assert.equal(savedResults.length, 1, "Missing or duplicate result");
      assert.equal(savedResults[0].id, result.messageId);
      assert.equal(savedResults[0].content, result.content);
      assert(
        messages.indexOf(owner) < messages.indexOf(savedResults[0]),
        "Result precedes assistant owner",
      );
    }
    if (scenario.stateKey) {
      const state = events.findLast(
        (event) => event.type === "STATE_SNAPSHOT",
      )?.snapshot;
      assert(state && scenario.stateKey in state, "State update missing");
      if (scenario.stateKey === "todos") {
        assert.deepEqual(
          state.todos.map(({ title, stage, value, assignee }) => ({
            title,
            stage,
            value,
            assignee,
          })),
          [
            { title: "Cedar", stage: "prospect", value: 100, assignee: "Ava" },
            { title: "Maple", stage: "lead", value: 200, assignee: "Ben" },
            { title: "Oak", stage: "negotiation", value: 300, assignee: "Cam" },
          ],
        );
      }
    }
    console.log(
      `PASS ${scenario.name} ${threadId}: ${starts.length} calls retained with arguments, results and order`,
    );
  } catch (error) {
    failures++;
    console.error(`FAIL ${scenario.name} ${threadId}: ${error.message}`);
  }
}
process.exitCode = failures ? 1 : 0;
