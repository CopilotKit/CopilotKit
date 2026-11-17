import { EventType } from "@ag-ui/client";
import type { BaseEvent, StateDeltaEvent } from "@ag-ui/client";
import { describe, expect, it } from "vitest";

import { convertStream } from "./tanstack-factory";

/**
 * The subagents demo renders its left-hand delegation log from
 * `agent.state.delegations` (`demos/subagents/page.tsx`). Nothing used to emit
 * that slot: the sub-agent tools ran and the chat filled in, but the panel stayed
 * empty forever. These tests pin the STATE_DELTA that fixes it.
 */

// The TanStack stream chunks that the converter reads.
type Chunk =
  | { type: "TOOL_CALL_START"; toolCallId: string; toolCallName: string }
  | { type: "TOOL_CALL_ARGS"; toolCallId: string; delta: string }
  | { type: "TOOL_CALL_END"; toolCallId: string }
  | { type: "TOOL_CALL_RESULT"; toolCallId: string; content: string };

async function* chunks(items: Chunk[]) {
  for (const item of items) yield item;
}

function collect(items: Chunk[]) {
  return Array.fromAsync(
    convertStream(chunks(items), new AbortController().signal),
  );
}

function isStateDelta(event: BaseEvent): event is StateDeltaEvent {
  return event.type === EventType.STATE_DELTA;
}

// The JSON Patch operations on `path`, one per STATE_DELTA.
function deltaOps(events: BaseEvent[], path: string) {
  return events
    .filter(isStateDelta)
    .map((event) => event.delta[0])
    .filter((op) => op.path === path);
}

/** One complete sub-agent tool call: start → streamed args → end → result. */
function delegationChunks(opts: {
  toolCallId: string;
  toolCallName: string;
  task: string;
  text: string;
}): Chunk[] {
  const args = JSON.stringify({ task: opts.task });
  const mid = Math.ceil(args.length / 2);
  return [
    {
      type: "TOOL_CALL_START",
      toolCallId: opts.toolCallId,
      toolCallName: opts.toolCallName,
    },
    // Split so the test exercises delta accumulation, not a single whole blob.
    {
      type: "TOOL_CALL_ARGS",
      toolCallId: opts.toolCallId,
      delta: args.slice(0, mid),
    },
    {
      type: "TOOL_CALL_ARGS",
      toolCallId: opts.toolCallId,
      delta: args.slice(mid),
    },
    { type: "TOOL_CALL_END", toolCallId: opts.toolCallId },
    {
      type: "TOOL_CALL_RESULT",
      toolCallId: opts.toolCallId,
      content: JSON.stringify({ role: opts.toolCallName, text: opts.text }),
    },
  ];
}

describe("convertStream: subagent delegations", () => {
  it("emits a /delegations entry carrying the task and the result text", async () => {
    const events = await collect(
      delegationChunks({
        toolCallId: "call-1",
        toolCallName: "research_agent",
        task: "Gather facts about tidal energy",
        text: "- Tides are predictable\n- Capacity factor ~30%",
      }),
    );

    // `add`, not `replace`: initial agent state is `{}`, and fast-json-patch
    // strict mode rejects `replace` on an unresolvable path, which
    // @ag-ui/client swallows, leaving the panel blank.
    expect(deltaOps(events, "/delegations")).toEqual([
      {
        op: "add",
        path: "/delegations",
        value: [
          {
            id: "call-1",
            sub_agent: "research_agent",
            task: "Gather facts about tidal energy",
            status: "completed",
            result: "- Tides are predictable\n- Capacity factor ~30%",
          },
        ],
      },
    ]);
  });

  it("accumulates across sub-agents, resending the whole grown list", async () => {
    const events = await collect([
      ...delegationChunks({
        toolCallId: "call-1",
        toolCallName: "research_agent",
        task: "Research",
        text: "facts",
      }),
      ...delegationChunks({
        toolCallId: "call-2",
        toolCallName: "writing_agent",
        task: "Draft",
        text: "prose",
      }),
    ]);

    // The second delta must carry BOTH entries: the frontend replaces the slot
    // wholesale, so sending only the new one would drop the first row.
    expect(deltaOps(events, "/delegations")).toMatchObject([
      { value: [{ sub_agent: "research_agent" }] },
      {
        value: [
          { sub_agent: "research_agent" },
          { sub_agent: "writing_agent" },
        ],
      },
    ]);
  });

  it("leaves non-subagent tools out of the delegation log", async () => {
    const events = await collect(
      delegationChunks({
        toolCallId: "call-1",
        toolCallName: "get_weather",
        task: "irrelevant",
        text: "sunny",
      }),
    );
    expect(deltaOps(events, "/delegations")).toEqual([]);
  });

  it("still emits the delegation when args are unparseable", async () => {
    // A run cut short mid-args should degrade to an entry with an empty task,
    // not a dropped row or a throw.
    const events = await collect([
      {
        type: "TOOL_CALL_START",
        toolCallId: "call-1",
        toolCallName: "critique_agent",
      },
      {
        type: "TOOL_CALL_ARGS",
        toolCallId: "call-1",
        delta: '{"task": "trunc',
      },
      {
        type: "TOOL_CALL_RESULT",
        toolCallId: "call-1",
        content: JSON.stringify({ role: "critique_agent", text: "ok" }),
      },
    ]);

    expect(deltaOps(events, "/delegations")).toMatchObject([
      { value: [{ task: "" }] },
    ]);
  });
});

describe("convertStream: set_steps", () => {
  it("translates a set_steps result into a /steps delta", async () => {
    const steps = [{ id: "1", title: "Plan", status: "pending" }];
    const events = await collect([
      { type: "TOOL_CALL_START", toolCallId: "s1", toolCallName: "set_steps" },
      { type: "TOOL_CALL_END", toolCallId: "s1" },
      {
        type: "TOOL_CALL_RESULT",
        toolCallId: "s1",
        content: JSON.stringify({ success: true, steps }),
      },
    ]);

    expect(deltaOps(events, "/steps")).toEqual([
      { op: "add", path: "/steps", value: steps },
    ]);
  });
});
