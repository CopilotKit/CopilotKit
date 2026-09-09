import { EventType } from "@ag-ui/client";
import { describe, expect, it } from "vitest";

import { convertStream } from "./tanstack-factory";

/**
 * The subagents demo renders its left-hand delegation log from
 * `agent.state.delegations` (`demos/subagents/page.tsx`). Nothing used to emit
 * that slot: the sub-agent tools ran and the chat filled in, but the panel stayed
 * empty forever. These tests pin the STATE_DELTA that fixes it.
 */

type Chunk = Record<string, unknown>;

async function* chunks(items: Chunk[]): AsyncIterable<Chunk> {
  for (const item of items) yield item;
}

async function collect(items: Chunk[]) {
  const out = [];
  for await (const event of convertStream(
    chunks(items),
    new AbortController().signal,
  )) {
    out.push(event);
  }
  return out;
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

function delegationDeltas(events: Array<Record<string, unknown>>) {
  return events
    .filter((e) => e.type === EventType.STATE_DELTA)
    .map((e) => (e.delta as Array<Record<string, unknown>>)[0])
    .filter((op) => op.path === "/delegations");
}

describe("convertStream — subagent delegations", () => {
  it("emits a /delegations entry carrying the task and the result text", async () => {
    const events = await collect(
      delegationChunks({
        toolCallId: "call-1",
        toolCallName: "research_agent",
        task: "Gather facts about tidal energy",
        text: "- Tides are predictable\n- Capacity factor ~30%",
      }),
    );

    const ops = delegationDeltas(events);
    expect(ops).toHaveLength(1);
    // `add`, not `replace`: initial agent state is `{}`, and fast-json-patch
    // strict mode rejects `replace` on an unresolvable path — which
    // @ag-ui/client swallows, leaving the panel blank.
    expect(ops[0].op).toBe("add");
    expect(ops[0].value).toEqual([
      {
        id: "call-1",
        sub_agent: "research_agent",
        task: "Gather facts about tidal energy",
        status: "completed",
        result: "- Tides are predictable\n- Capacity factor ~30%",
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

    const ops = delegationDeltas(events);
    expect(ops).toHaveLength(2);
    expect((ops[0].value as unknown[]).length).toBe(1);
    // The second delta must carry BOTH entries — the frontend replaces the slot
    // wholesale, so sending only the new one would drop the first row.
    const second = ops[1].value as Array<{ sub_agent: string }>;
    expect(second.map((d) => d.sub_agent)).toEqual([
      "research_agent",
      "writing_agent",
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
    expect(delegationDeltas(events)).toEqual([]);
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

    const ops = delegationDeltas(events);
    expect(ops).toHaveLength(1);
    expect((ops[0].value as Array<{ task: string }>)[0].task).toBe("");
  });
});

describe("convertStream — set_steps", () => {
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

    const op = events
      .filter((e) => e.type === EventType.STATE_DELTA)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((e) => (e as any).delta[0])
      .find((o) => o.path === "/steps");
    expect(op).toBeDefined();
    expect(op.value).toEqual(steps);
  });
});
