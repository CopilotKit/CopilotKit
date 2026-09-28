import type { AssistantMessage, Message, ToolMessage } from "@ag-ui/client";
import { describe, expect, it } from "vitest";

import { ɵbuildSubagentLayout } from "../subagent-layout";
import type { Subagent } from "../subagent-state";

function user(id: string): Message {
  return { id, role: "user", content: `question ${id}` };
}

function assistant(
  id: string,
  options: { subagentRunId?: string; toolCallIds?: string[] } = {},
): AssistantMessage {
  const { subagentRunId, toolCallIds } = options;
  return {
    id,
    role: "assistant",
    content: `answer ${id}`,
    subagentRunId,
    toolCalls: toolCallIds?.map((toolCallId) => ({
      id: toolCallId,
      type: "function",
      function: { name: "delegate", arguments: "{}" },
    })),
  };
}

function toolResult(
  id: string,
  toolCallId: string,
  subagentRunId?: string,
): ToolMessage {
  return { id, role: "tool", toolCallId, content: "ok", subagentRunId };
}

function subagent(
  subagentRunId: string,
  overrides: Partial<Subagent> = {},
): Subagent {
  return {
    subagentRunId,
    name: `${subagentRunId}-agent`,
    status: "running",
    ...overrides,
  };
}

/** Group ids per anchor, so assertions read as the rendered tree. */
function anchors(layout: ReturnType<typeof ɵbuildSubagentLayout>) {
  const ids = (map: Map<string | null, { subagentRunId: string }[]>) =>
    Object.fromEntries(
      [...map].map(([key, groups]) => [
        String(key),
        groups.map((group) => group.subagentRunId),
      ]),
    );
  return {
    topLevel: layout.topLevel.map((message) => message.id),
    byToolCallId: ids(layout.byToolCallId),
    bySubagentRunId: ids(layout.bySubagentRunId),
    afterMessageId: ids(layout.afterMessageId),
  };
}

describe("ɵbuildSubagentLayout", () => {
  it("returns the input untouched when no message is attributed", () => {
    const messages = [user("u1"), assistant("a1")];
    const layout = ɵbuildSubagentLayout(messages, []);

    expect(layout.topLevel).toEqual(messages);
    expect(anchors(layout)).toEqual({
      topLevel: ["u1", "a1"],
      byToolCallId: {},
      bySubagentRunId: {},
      afterMessageId: {},
    });
  });

  it("puts two parallel subagents under the tool calls that started them, keeping each one's messages in order", () => {
    const research = subagent("research", { parentToolCallId: "call-1" });
    const write = subagent("write", { parentToolCallId: "call-2" });
    const messages = [
      user("u1"),
      assistant("supervisor", { toolCallIds: ["call-1", "call-2"] }),
      assistant("r1", { subagentRunId: "research" }),
      assistant("w1", { subagentRunId: "write" }),
      assistant("r2", { subagentRunId: "research" }),
      toolResult("t1", "call-1"),
      toolResult("t2", "call-2"),
    ];

    const layout = ɵbuildSubagentLayout(messages, [research, write]);

    expect(anchors(layout)).toEqual({
      topLevel: ["u1", "supervisor", "t1", "t2"],
      byToolCallId: { "call-1": ["research"], "call-2": ["write"] },
      bySubagentRunId: {},
      afterMessageId: {},
    });
    expect(layout.byToolCallId.get("call-1")).toEqual([
      {
        subagentRunId: "research",
        subagent: research,
        messages: [messages[2], messages[4]],
      },
    ]);
  });

  it("nests a child under the tool call inside its parent's messages, or under the parent when it has no tool call", () => {
    const messages = [
      assistant("supervisor", { toolCallIds: ["call-1"] }),
      assistant("r1", { subagentRunId: "research", toolCallIds: ["call-2"] }),
      assistant("s1", { subagentRunId: "search" }),
      assistant("n1", { subagentRunId: "notes" }),
    ];

    const layout = ɵbuildSubagentLayout(messages, [
      subagent("research", { parentToolCallId: "call-1" }),
      subagent("search", {
        parentToolCallId: "call-2",
        parentSubagentRunId: "research",
      }),
      subagent("notes", { parentSubagentRunId: "research" }),
    ]);

    expect(anchors(layout)).toEqual({
      topLevel: ["supervisor"],
      byToolCallId: { "call-1": ["research"], "call-2": ["search"] },
      bySubagentRunId: { research: ["notes"] },
      afterMessageId: {},
    });
  });

  it("shows a subagent that has not sent a message yet, so a running group appears at once", () => {
    const layout = ɵbuildSubagentLayout(
      [assistant("supervisor", { toolCallIds: ["call-1"] })],
      [subagent("research", { parentToolCallId: "call-1" })],
    );

    expect(layout.byToolCallId.get("call-1")).toEqual([
      {
        subagentRunId: "research",
        subagent: subagent("research", { parentToolCallId: "call-1" }),
        messages: [],
      },
    ]);
  });

  it("groups an unannounced id with no subagent entry, at its first message's position", () => {
    const messages = [
      user("u1"),
      assistant("x1", { subagentRunId: "unannounced" }),
      assistant("a1"),
      assistant("x2", { subagentRunId: "unannounced" }),
    ];

    const layout = ɵbuildSubagentLayout(messages, []);

    expect(anchors(layout)).toEqual({
      topLevel: ["u1", "a1"],
      byToolCallId: {},
      bySubagentRunId: {},
      afterMessageId: { u1: ["unannounced"] },
    });
    expect(layout.afterMessageId.get("u1")).toEqual([
      {
        subagentRunId: "unannounced",
        subagent: undefined,
        messages: [messages[1], messages[3]],
      },
    ]);
  });

  it("falls back to the parent, then to the first-message position, when the anchor tool call is missing", () => {
    const layout = ɵbuildSubagentLayout(
      [
        user("u1"),
        assistant("p1", { subagentRunId: "parent" }),
        assistant("c1", { subagentRunId: "child" }),
        assistant("o1", { subagentRunId: "orphan" }),
      ],
      [
        subagent("parent", { parentToolCallId: "pruned-call" }),
        subagent("child", {
          parentToolCallId: "pruned-call-2",
          parentSubagentRunId: "parent",
        }),
        subagent("orphan", {
          parentToolCallId: "pruned-call-3",
          parentSubagentRunId: "unknown",
        }),
      ],
    );

    expect(anchors(layout)).toEqual({
      topLevel: ["u1"],
      byToolCallId: {},
      bySubagentRunId: { parent: ["child"] },
      afterMessageId: { u1: ["parent", "orphan"] },
    });
  });

  it("places a group before the first message when nothing precedes it", () => {
    const layout = ɵbuildSubagentLayout(
      [assistant("x1", { subagentRunId: "early" }), user("u1")],
      [],
    );

    expect(anchors(layout).afterMessageId).toEqual({ null: ["early"] });
  });

  it("breaks parent cycles so every group still renders once", () => {
    const layout = ɵbuildSubagentLayout(
      [
        user("u1"),
        assistant("a1", { subagentRunId: "a", toolCallIds: ["call-a"] }),
        assistant("b1", { subagentRunId: "b", toolCallIds: ["call-b"] }),
        assistant("s1", { subagentRunId: "self" }),
      ],
      [
        subagent("a", { parentToolCallId: "call-b" }),
        subagent("b", { parentToolCallId: "call-a" }),
        subagent("self", { parentSubagentRunId: "self" }),
      ],
    );

    const rendered = [
      ...layout.byToolCallId.values(),
      ...layout.bySubagentRunId.values(),
      ...layout.afterMessageId.values(),
    ]
      .flat()
      .map((group) => group.subagentRunId)
      .sort();
    expect(rendered).toEqual(["a", "b", "self"]);
    expect(anchors(layout)).toEqual({
      topLevel: ["u1"],
      byToolCallId: { "call-a": ["b"] },
      bySubagentRunId: {},
      afterMessageId: { u1: ["a", "self"] },
    });
  });
});
