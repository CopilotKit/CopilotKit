import assert from "node:assert/strict";

/** Reconstruct source expectations only from the recorded framework boundary.
 * Re-sent full histories update existing IDs; separately emitted tool calls are
 * never deduplicated by value. The raw runs remain the authority in artifacts.
 */
export function frameworkSource(runs) {
  assert.ok(
    Array.isArray(runs) && runs.length,
    "Framework input/event runs required",
  );
  const messages = [];
  const byId = new Map();
  const calls = new Map();
  const interruptCalls = new Set();
  let state;
  let threadId;
  let activeText;
  const put = (message) => {
    assert.ok(message.id, "Framework message identity required");
    const existing = byId.get(message.id);
    if (existing) Object.assign(existing, structuredClone(message));
    else {
      const copy = structuredClone(message);
      messages.push(copy);
      byId.set(copy.id, copy);
    }
    for (const call of byId.get(message.id).toolCalls ?? [])
      calls.set(call.id, call);
    return byId.get(message.id);
  };
  for (const run of runs) {
    assert.ok(
      run.input?.threadId &&
        Array.isArray(run.input.messages) &&
        Array.isArray(run.events),
      "Raw framework input and events required",
    );
    threadId ??= run.input.threadId;
    assert.equal(
      run.input.threadId,
      threadId,
      "Framework capture mixed native threads",
    );
    for (const message of run.input.messages) put(message);
    if (run.input.state !== undefined) state = structuredClone(run.input.state);
    for (const event of run.events) {
      if (
        ["TEXT_MESSAGE_START", "REASONING_MESSAGE_START"].includes(event.type)
      ) {
        activeText = event.messageId;
        put({
          id: event.messageId,
          role:
            event.type === "REASONING_MESSAGE_START"
              ? "reasoning"
              : (event.role ?? "assistant"),
          content: "",
        });
      } else if (
        [
          "TEXT_MESSAGE_CONTENT",
          "TEXT_MESSAGE_CHUNK",
          "REASONING_MESSAGE_CONTENT",
        ].includes(event.type)
      ) {
        const id = event.messageId ?? activeText;
        const message = byId.get(id);
        assert.ok(message, "Text delta has no framework message start");
        assert.equal(typeof message.content, "string");
        message.content += event.delta ?? "";
      } else if (event.type === "TOOL_CALL_START") {
        if (interruptCalls.delete(event.toolCallId)) {
          const call = calls.get(event.toolCallId);
          assert.equal(
            call.function.name,
            event.toolCallName,
            "Resumed tool identity changed",
          );
          call.function.arguments = "";
          continue;
        }
        assert.ok(
          event.toolCallId && !calls.has(event.toolCallId),
          "Duplicate emitted framework tool call ID",
        );
        const id = event.parentMessageId ?? event.toolCallId;
        const message =
          byId.get(id) ?? put({ id, role: "assistant", content: "" });
        const call = {
          id: event.toolCallId,
          type: "function",
          function: { name: event.toolCallName, arguments: "" },
        };
        message.toolCalls ??= [];
        message.toolCalls.push(call);
        calls.set(call.id, call);
      } else if (event.type === "TOOL_CALL_ARGS") {
        const call = calls.get(event.toolCallId);
        assert.ok(call, "Tool args have no framework tool start");
        call.function.arguments += event.delta ?? "";
      } else if (event.type === "TOOL_CALL_RESULT") {
        assert.ok(
          calls.has(event.toolCallId),
          "Tool result has no framework call",
        );
        put({
          id: event.messageId ?? `result-${event.toolCallId}`,
          role: "tool",
          toolCallId: event.toolCallId,
          content: event.content,
        });
      } else if (event.type === "MESSAGES_SNAPSHOT") {
        assert.ok(
          Array.isArray(event.messages),
          "Invalid framework messages snapshot",
        );
        for (const message of event.messages) put(message);
      } else if (
        event.type === "RUN_FINISHED" &&
        event.outcome?.type === "interrupt"
      ) {
        for (const interrupt of event.outcome.interrupts) {
          const payload = interrupt.metadata?.mastra;
          if (
            !calls.has(interrupt.toolCallId) &&
            payload?.toolName &&
            payload.args !== undefined
          ) {
            put({
              id: `interrupt-${interrupt.id}`,
              role: "assistant",
              content: "",
              toolCalls: [
                {
                  id: interrupt.toolCallId,
                  type: "function",
                  function: {
                    name: payload.toolName,
                    arguments: JSON.stringify(payload.args),
                  },
                },
              ],
            });
            interruptCalls.add(interrupt.toolCallId);
          }
        }
      } else if (event.type === "STATE_SNAPSHOT")
        state = structuredClone(event.snapshot);
      else if (event.type === "STATE_DELTA") {
        // State deltas cannot be ignored: an unsupported delta-only transcript
        // must not compare stale input state and produce a false green.
        state = applyStateDelta(state, event.delta);
      }
    }
  }
  return {
    threadId,
    messages,
    state,
    events: runs.flatMap((run) => run.events),
    inputs: runs.map((run) => run.input),
    runIds: runs.map((run) => run.input.runId),
  };
}

function tokens(pointer) {
  assert.ok(
    typeof pointer === "string" && (pointer === "" || pointer.startsWith("/")),
    "Invalid state pointer",
  );
  return pointer === ""
    ? []
    : pointer
        .slice(1)
        .split("/")
        .map((token) => {
          assert.ok(!/~(?![01])/u.test(token), "Invalid state pointer escape");
          const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
          assert.ok(
            !["__proto__", "constructor", "prototype"].includes(key),
            "Unsafe state pointer",
          );
          return key;
        });
}
function valueAt(state, path) {
  return tokens(path).reduce((value, key) => value?.[key], state);
}
function applyStateDelta(initial, operations) {
  assert.ok(Array.isArray(operations), "State delta operations required");
  let state = structuredClone(initial ?? {});
  for (const operation of operations) {
    const { op, path } = operation;
    const keys = tokens(path);
    if (op === "test") {
      assert.deepEqual(
        valueAt(state, path),
        operation.value,
        "Framework state test failed",
      );
      continue;
    }
    assert.ok(
      ["add", "remove", "replace", "copy", "move"].includes(op),
      "Unknown framework state operation",
    );
    let value = operation.value;
    if (op === "copy" || op === "move") {
      value = structuredClone(valueAt(state, operation.from));
      assert.notEqual(value, undefined, "Missing state copy/move source");
      if (op === "move")
        state = applyStateDelta(state, [
          { op: "remove", path: operation.from },
        ]);
    }
    if (!keys.length) {
      assert.notEqual(op, "remove", "Cannot remove root state");
      state = structuredClone(value);
      continue;
    }
    const key = keys.pop();
    let parent = state;
    for (const segment of keys) {
      assert.ok(
        parent && Object.hasOwn(parent, segment),
        "Missing state delta parent",
      );
      parent = parent[segment];
    }
    assert.ok(
      parent && typeof parent === "object",
      "Invalid state delta parent",
    );
    if (Array.isArray(parent)) {
      const index = key === "-" ? parent.length : Number(key);
      assert.ok(
        (key === "-" || /^(0|[1-9]\d*)$/.test(key)) &&
          Number.isSafeInteger(index) &&
          index <= parent.length,
        "Invalid state array index",
      );
      if (op === "remove" || op === "replace")
        assert.ok(index < parent.length, "Missing state array entry");
      if (op === "remove") parent.splice(index, 1);
      else if (op === "replace") parent[index] = structuredClone(value);
      else parent.splice(index, 0, structuredClone(value));
    } else {
      if (op === "remove" || op === "replace")
        assert.ok(Object.hasOwn(parent, key), "Missing state object entry");
      if (op === "remove") delete parent[key];
      else parent[key] = structuredClone(value);
    }
  }
  return state;
}
