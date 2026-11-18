import { describe, it, expect } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { from } from "rxjs";
import { CopilotKitCore } from "../core";
import { createTool } from "./test-utils";

const TOOL_CALL_ID = "call-1";
const TOOL_NAME = "lookup";

// Core marks a call executing right after it calls the handler, so each
// handler below reads the set after its first `await`.

/** An agent whose run calls `lookup` once, then finishes. */
class ToolCallingAgent extends AbstractAgent {
  run(input: RunAgentInput) {
    const events: BaseEvent[] = [
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
      {
        type: EventType.TOOL_CALL_START,
        toolCallId: TOOL_CALL_ID,
        toolCallName: TOOL_NAME,
        parentMessageId: "assistant-1",
      },
      {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: TOOL_CALL_ID,
        delta: '{"q":"x"}',
      },
      { type: EventType.TOOL_CALL_END, toolCallId: TOOL_CALL_ID },
      {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      },
    ];
    return from(events);
  }
}

function setup(handler: () => Promise<string>) {
  const core = new CopilotKitCore({});
  let handlerCalled = false;
  core.addTool(
    createTool({
      name: TOOL_NAME,
      handler: () => {
        handlerCalled = true;
        return handler();
      },
      followUp: false,
    }),
  );
  const agent = new ToolCallingAgent({ agentId: "default", threadId: "t1" });
  core.addAgent__unsafe_dev_only({ id: "default", agent });

  /**
   * Each change: the ids, whether the handler had been called, and whether
   * the call's result was in the messages.
   */
  const changes: {
    ids: string[];
    handlerCalled: boolean;
    hasResult: boolean;
  }[] = [];
  core.subscribe({
    onExecutingToolCallsChanged: ({ executingToolCallIds }) => {
      changes.push({
        ids: [...executingToolCallIds],
        handlerCalled,
        hasResult: agent.messages.some(
          (m) => m.role === "tool" && m.toolCallId === TOOL_CALL_ID,
        ),
      });
    },
  });
  return { core, agent, changes };
}

describe("CopilotKitCore.executingToolCallIds", () => {
  it("holds the call while its handler runs and drops it once the result is in", async () => {
    let seenDuringHandler: string[] = [];
    const { core, agent, changes } = setup(async () => {
      await Promise.resolve();
      seenDuringHandler = [...core.executingToolCallIds];
      return "found";
    });

    await core.runAgent({ agent });

    expect(seenDuringHandler).toEqual([TOOL_CALL_ID]);
    expect(core.executingToolCallIds.size).toBe(0);
    // The handler is already waiting when the call shows as executing, so a
    // HITL `respond` drawn for it always resolves the handler.
    expect(changes).toEqual([
      { ids: [TOOL_CALL_ID], handlerCalled: true, hasResult: false },
      { ids: [], handlerCalled: true, hasResult: true },
    ]);
  });

  it("drops the call when its handler throws", async () => {
    const { core, agent, changes } = setup(async () => {
      throw new Error("boom");
    });

    await core.runAgent({ agent });

    expect(core.executingToolCallIds.size).toBe(0);
    expect(changes.at(-1)).toEqual({
      ids: [],
      handlerCalled: true,
      hasResult: true,
    });
  });

  it("replaces the set on each change instead of mutating it", async () => {
    let duringHandler: ReadonlySet<string> | undefined;
    const { core, agent } = setup(async () => {
      await Promise.resolve();
      duringHandler = core.executingToolCallIds;
      return "found";
    });
    const before = core.executingToolCallIds;

    await core.runAgent({ agent });

    expect(duringHandler).not.toBe(before);
    expect([...before]).toEqual([]);
    expect([...(duringHandler ?? [])]).toEqual([TOOL_CALL_ID]);
  });

  it("tracks calls started with runTool", async () => {
    let seenDuringHandler: string[] = [];
    const { core } = setup(async () => {
      await Promise.resolve();
      seenDuringHandler = [...core.executingToolCallIds];
      return "found";
    });

    const { toolCallId } = await core.runTool({ name: TOOL_NAME });

    expect(seenDuringHandler).toEqual([toolCallId]);
    expect(core.executingToolCallIds.size).toBe(0);
  });
});
