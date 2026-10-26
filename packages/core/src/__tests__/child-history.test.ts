import { describe, expect, it, vi } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type {
  BaseEvent,
  CustomEvent,
  RunAgentInput,
  RunFinishedEvent,
  ToolCallResultEvent,
} from "@ag-ui/client";
import { from } from "rxjs";
import { CopilotKitCore } from "../core";
import {
  createMessage,
  createTool,
  getAssistantMessage,
  getToolMessage,
} from "./test-utils";

// This agent exercises the actual AG-UI subscriber pipeline, without a provider.
class ChildReplayAgent extends AbstractAgent {
  readonly inputs: RunAgentInput[] = [];
  events: BaseEvent[] = [];

  constructor(agentId = "child-replay", threadId = "thread-one") {
    super({
      agentId,
      threadId,
      initialMessages: [
        createMessage({ id: "root-user", content: "Make a chart" }),
      ],
    });
  }

  run(input: RunAgentInput) {
    this.inputs.push(input);
    return from([
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
      ...this.events,
      ...(this.events.at(-1)?.type === EventType.RUN_FINISHED
        ? []
        : [
            {
              type: EventType.RUN_FINISHED,
              threadId: input.threadId,
              runId: input.runId,
            },
          ]),
    ]);
  }
}

function savedHistory(
  namespace = ["research"],
  parent = "delegate",
  callId = "chart-call",
  value = 7,
) {
  return {
    namespace,
    parentToolCallIds: [parent],
    runs: [
      {
        sourceRunId: "native-run",
        status: "success",
        messages: [
          {
            sourceMessageId: "native-assistant",
            role: "assistant" as const,
            content: [
              {
                type: "tool_call" as const,
                id: callId,
                name: "chart",
                args: { value },
              },
            ],
          },
        ],
      },
    ],
  };
}

function historyEvent(value: unknown): CustomEvent {
  return { type: EventType.CUSTOM, name: "cpki.child_histories", value };
}

function snapshot(...histories: ReturnType<typeof savedHistory>[]) {
  return historyEvent({ version: 1, histories });
}

function chunks(histories: ReturnType<typeof savedHistory>[], size = 90) {
  return histories.flatMap((history, historyIndex) => {
    const data = JSON.stringify(history);
    const chunkCount = Math.ceil(data.length / size);
    return Array.from({ length: chunkCount }, (_, chunkIndex) =>
      historyEvent({
        version: 2,
        historyIndex,
        historyCount: histories.length,
        chunkIndex,
        chunkCount,
        data: data.slice(chunkIndex * size, (chunkIndex + 1) * size),
      }),
    );
  });
}

function result(
  parent = "delegate",
  callId = "chart-call",
  error = false,
): ToolCallResultEvent {
  return {
    type: EventType.TOOL_CALL_RESULT,
    messageId: `result-${callId}`,
    toolCallId: callId,
    content: error
      ? '{"status":"cancelled"}'
      : '{"status":"displayed","value":7}',
    rawEvent: { parent_tool_use_id: parent, is_error: error },
  };
}

function setup() {
  const agent = new ChildReplayAgent();
  const handler = vi.fn(async () => "must not execute");
  const core = new CopilotKitCore({
    tools: [createTool({ name: "chart", handler })],
  });
  core.setAgents__unsafe_dev_only({ [agent.agentId!]: agent });
  const current = () => core.ɵchildHistories.get(agent, agent.threadId);
  const play = async (...events: BaseEvent[]) => {
    agent.events = events;
    await agent.runAgent();
    return current();
  };
  return { agent, core, handler, current, play };
}

const mediaKinds = [
  { modality: "image", mimeType: "image/png", filename: "image.png" },
  { modality: "document", mimeType: "application/pdf", filename: "paper.pdf" },
  { modality: "audio", mimeType: "audio/wav", filename: "sound.wav" },
  { modality: "video", mimeType: "video/mp4", filename: "clip.mp4" },
] as const;
const mediaCases = (["user", "tool", "assistant"] as const).flatMap((role) =>
  mediaKinds.flatMap((kind) =>
    (["url", "file", "data"] as const).flatMap((sourceType) =>
      (sourceType === "data"
        ? ["block" as const]
        : (["source", "block"] as const)
      ).map((mimePlacement) => ({ role, ...kind, sourceType, mimePlacement })),
    ),
  ),
);

describe("child media presentation fidelity", () => {
  it.each(mediaCases)(
    "preserves $role $modality $sourceType with MIME at $mimePlacement",
    async ({
      role,
      modality,
      mimeType,
      filename,
      sourceType,
      mimePlacement,
    }) => {
      const { agent, play, current, handler } = setup();
      const root = structuredClone(agent.messages);
      const value =
        sourceType === "url"
          ? `https://example.invalid/${filename}`
          : sourceType === "file"
            ? `opaque-${filename}`
            : "U1lOVEhFVElD";
      const source = {
        type: sourceType,
        value,
        ...(sourceType === "file" ? { provider: "saved-provider" } : {}),
        ...(mimePlacement === "source" ? { mimeType } : {}),
      };
      const block = {
        type: "media",
        modality,
        filename,
        ...(sourceType === "data" ? { dataBase64: value } : { source }),
        ...(mimePlacement === "block" ? { mimeType } : {}),
      };
      const history = {
        namespace: ["child"],
        parentToolCallIds: ["delegate"],
        runs: [
          {
            sourceRunId: "saved-run",
            messages: [
              {
                sourceMessageId: "native-media",
                role,
                ...(role === "tool" ? { toolCallId: "media-call" } : {}),
                content: [
                  { type: "text", text: "Before" },
                  block,
                  { type: "text", text: "After" },
                ],
              },
            ],
          },
        ],
      };
      const original = structuredClone(history);
      const event = historyEvent({ version: 1, histories: [history] });
      await play(event);
      await play(event);
      expect(current().error).toBeUndefined();
      expect(current().histories).toHaveLength(1);
      const child = current().histories[0]!;
      expect(child.namespace).toEqual(["child"]);
      expect(child.parentToolCallIds).toEqual(["delegate"]);
      expect(child.messages).toHaveLength(1);
      const message = child.messages[0]!;
      expect(message.id).toBe("native-media");
      expect(message.role).toBe(role);
      const parts =
        role === "assistant" ? message.contentParts : message.content;
      expect(parts).toEqual([
        { type: "text", text: "Before" },
        {
          type: modality,
          source: { ...source, mimeType },
          metadata: { filename },
        },
        { type: "text", text: "After" },
      ]);
      if (role === "assistant") {
        expect(typeof message.content).toBe("string");
        expect(message.content).toContain(value);
        expect(message.content).toContain(filename);
      }
      if (message.role === "tool")
        expect(message.toolCallId).toBe("media-call");
      expect(agent.messages).toEqual(root);
      expect(agent.inputs.map((input) => input.messages)).toEqual([root, root]);
      expect(history).toEqual(original);
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it("keeps source MIME authoritative and assistant media scoped to sibling namespaces", async () => {
    const { play, current } = setup();
    await play(
      historyEvent({
        version: 1,
        histories: ["left", "right"].map((namespace) => ({
          namespace: [namespace],
          parentToolCallIds: [`${namespace}-delegate`],
          runs: [
            {
              sourceRunId: "saved-run",
              messages: [
                {
                  sourceMessageId: "reused-native-id",
                  role: "assistant",
                  content: [
                    {
                      type: "media",
                      modality: "image",
                      mimeType: "application/octet-stream",
                      source: {
                        type: "file",
                        value: `${namespace}-file`,
                        mimeType: "image/png",
                        provider: "saved-provider",
                      },
                    },
                  ],
                },
              ],
            },
          ],
        })),
      }),
    );
    expect(current().error).toBeUndefined();
    for (const [index, namespace] of ["left", "right"].entries()) {
      const message = current().histories[index]!.messages[0]!;
      expect(message.id).toBe("reused-native-id");
      expect(message.contentParts).toEqual([
        {
          type: "image",
          source: {
            type: "file",
            value: `${namespace}-file`,
            mimeType: "image/png",
            provider: "saved-provider",
          },
        },
      ]);
      expect(message.content).toBe(`[image: ${namespace}-file]`);
    }
  });
});

describe("child-history presentation store", () => {
  it("retains original calls separately from provider-facing messages and never executes them", async () => {
    const { agent, core, handler, current } = setup();
    const root = structuredClone(agent.messages);
    agent.events = [snapshot(savedHistory())];
    await core.runAgent({ agent });
    agent.events = [];
    await core.runAgent({ agent });

    expect(
      getAssistantMessage(current().histories[0]?.messages[0]).toolCalls,
    ).toEqual([
      {
        id: "chart-call",
        type: "function",
        function: { name: "chart", arguments: '{"value":7}' },
      },
    ]);
    expect(agent.messages).toEqual(root);
    expect(agent.inputs.map((input) => input.messages)).toEqual([root, root]);
    expect(handler).not.toHaveBeenCalled();
  });

  it("publishes a v2 snapshot atomically after all histories and chunks arrive", async () => {
    const { agent, play, current } = setup();
    await play(snapshot(savedHistory(["old"])));
    const previous = current();
    const events = chunks([
      savedHistory(),
      savedHistory(["research", "leaf"], "nested"),
    ]);
    const observed: ReturnType<typeof current>[] = [];
    const subscription = agent.subscribe({
      onCustomEvent: () => {
        observed.push(current());
      },
    });
    await play(...events);
    subscription.unsubscribe();
    expect(observed).toHaveLength(events.length);
    for (const partial of observed.slice(0, -1)) expect(partial).toBe(previous);
    expect(observed.at(-1)).toBe(current());
    expect(current().histories.map((h) => h.namespace)).toEqual([
      ["research"],
      ["research", "leaf"],
    ]);
    expect(current().error).toBeUndefined();
  });

  it("discards a partial prior replacement when a new snapshot begins", async () => {
    const { play, current } = setup();
    const unfinished = chunks([savedHistory(["discard"])]);
    await play(
      ...unfinished.slice(0, -1),
      ...chunks([savedHistory(["replacement"], "next", "new-call", 8)]),
    );
    expect(current().histories.map((h) => h.namespace)).toEqual([
      ["replacement"],
    ]);
    expect(
      getAssistantMessage(current().histories[0]?.messages[0]).toolCalls?.[0]
        ?.id,
    ).toBe("new-call");
  });

  it("accepts duplicate delivery of every v2 chunk without corrupting the snapshot", async () => {
    const { play, current } = setup();
    const events = chunks([
      savedHistory(),
      savedHistory(["research", "leaf"], "nested"),
    ]);
    await play(...events.flatMap((event) => [event, event]));
    expect(current().error).toBeUndefined();
    expect(current().histories.map((history) => history.namespace)).toEqual([
      ["research"],
      ["research", "leaf"],
    ]);
    expect(
      current().histories.map((history) => history.messages.length),
    ).toEqual([1, 1]);
  });

  it("reports an incomplete snapshot at run end without exposing a partial tree", async () => {
    const { agent, play, current } = setup();
    await play(snapshot(savedHistory(["old"])));
    const previous = current();
    const observed: ReturnType<typeof current>[] = [];
    const subscription = agent.subscribe({
      onCustomEvent: () => {
        observed.push(current());
      },
    });
    const incomplete = chunks([savedHistory(["incomplete"])]).slice(0, -1);
    await play(...incomplete);
    subscription.unsubscribe();
    expect(observed).toHaveLength(incomplete.length);
    for (const partial of observed) expect(partial).toBe(previous);
    expect(current().histories).toBe(previous.histories);
    expect(current().error).toMatch(/incomplete/i);
    await play(...chunks([savedHistory(["complete"])]));
    expect(current().error).toBeUndefined();
    expect(current().histories[0]?.namespace).toEqual(["complete"]);
  });

  it("accepts the same snapshot start after a truncated connection is replayed", async () => {
    const { play, current } = setup();
    const events = chunks([savedHistory()]);
    await play(events[0]!);
    expect(current().error).toMatch(/incomplete/i);
    await play(...events);
    expect(current().error).toBeUndefined();
    expect(current().histories[0]?.namespace).toEqual(["research"]);
  });

  it("preserves normalized JSON string arguments rather than parsing them as serialized objects", async () => {
    const { play, current } = setup();
    const history = savedHistory();
    await play(
      historyEvent({
        version: 1,
        histories: [
          {
            ...history,
            runs: [
              {
                sourceRunId: "native-run",
                messages: [
                  {
                    sourceMessageId: "string-argument",
                    role: "assistant",
                    content: [
                      {
                        type: "tool_call",
                        id: "string-call",
                        name: "echo",
                        args: "literal text",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(
      getAssistantMessage(current().histories[0]?.messages[0]).toolCalls?.[0]
        ?.function.arguments,
    ).toBe('"literal text"');
  });

  it("reports conflicting chunk order without replacing valid history, then recovers", async () => {
    const { play, current } = setup();
    await play(snapshot(savedHistory()));
    const before = current().histories;
    const replacement = chunks([savedHistory(["next"])]);
    await play(replacement[0]!, replacement[2]!);
    expect(current().histories).toBe(before);
    expect(current().error).toContain(
      "Incomplete or conflicting child snapshot",
    );
    await play(snapshot(savedHistory(["valid"])));
    expect(current().error).toBeUndefined();
    expect(current().histories[0]?.namespace).toEqual(["valid"]);
  });

  it.each([
    { version: 1, histories: [savedHistory(), savedHistory()] },
    { version: 1, histories: [savedHistory(["missing", "leaf"])] },
    {
      version: 2,
      historyIndex: 0,
      historyCount: 1,
      chunkIndex: 0,
      chunkCount: 1,
      data: "not json",
    },
  ])(
    "rejects malformed snapshots without losing the last valid snapshot (%#)",
    async (invalid) => {
      const { play, current } = setup();
      await play(snapshot(savedHistory()));
      const before = current().histories;
      await play(historyEvent(invalid));
      expect(current().histories).toBe(before);
      expect(current().error).toContain(
        "Unable to display saved child history",
      );
    },
  );

  it("joins results by parent ownership when siblings reuse native message and call IDs", async () => {
    const { play, current } = setup();
    await play(
      snapshot(
        savedHistory(["left"], "parent-left"),
        savedHistory(["right"], "parent-right"),
      ),
    );
    await play(result("parent-right"));
    const [left, right] = current().histories;
    expect(left?.messages).toHaveLength(1);
    expect(getToolMessage(right?.messages[1]).content).toBe(
      '{"status":"displayed","value":7}',
    );
    expect(getAssistantMessage(left?.messages[0]).id).toBe("native-assistant");
    expect(getAssistantMessage(right?.messages[0]).id).toBe("native-assistant");
  });

  it("does not assign results with ambiguous or mismatched parent ownership", async () => {
    const { play, current } = setup();
    await play(snapshot(savedHistory(["left"]), savedHistory(["right"])));
    await play(result(), result("unknown-parent"));
    expect(current().histories.map((h) => h.messages.length)).toEqual([1, 1]);
  });

  it("replays result-only completion once and preserves cancellation errors", async () => {
    const { play, current } = setup();
    await play(snapshot(savedHistory()));
    await play(
      result("delegate", "chart-call", true),
      result("delegate", "chart-call", true),
    );
    expect(current().histories[0]?.messages).toHaveLength(2);
    expect(getToolMessage(current().histories[0]?.messages[1])).toMatchObject({
      toolCallId: "chart-call",
      content: '{"status":"cancelled"}',
      error: "Tool execution failed",
    });
  });

  it("retains an observed completion when an older imported snapshot is replayed", async () => {
    const { play, current } = setup();
    await play(snapshot(savedHistory()), result());
    await play(...chunks([savedHistory()]));
    const messages = current().histories[0]?.messages;
    expect(messages).toHaveLength(2);
    expect(getToolMessage(messages?.[1])).toMatchObject({
      toolCallId: "chart-call",
      content: '{"status":"displayed","value":7}',
    });
  });

  it("retains child follow-up calls from interrupts and associates their later results", async () => {
    const { agent, play, current } = setup();
    await play(snapshot(savedHistory()));
    const interrupt: RunFinishedEvent = {
      type: EventType.RUN_FINISHED,
      threadId: agent.threadId,
      runId: "interrupted-run",
      outcome: {
        type: "interrupt",
        interrupts: [
          {
            id: "followup",
            toolCallId: "followup",
            reason: "tool_call",
            metadata: {
              source: "claude-sdk-native-child",
              childId: "research",
              parentToolUseId: "delegate",
              toolName: "mcp__ag_ui__chart",
              input: { value: 8 },
            },
          },
        ],
      },
    };
    await play(interrupt);
    agent.events = [result("delegate", "followup")];
    await agent.runAgent({
      resume: [
        {
          interruptId: "followup",
          status: "resolved",
          payload: { status: "displayed" },
        },
      ],
    });
    const calls = current().histories[0]?.messages.flatMap((m) =>
      m.role === "assistant" ? (m.toolCalls ?? []) : [],
    );
    expect(calls?.map((c) => c.id)).toEqual(["chart-call", "followup"]);
    expect(calls?.[1]?.function).toEqual({
      name: "chart",
      arguments: '{"value":8}',
    });
    expect(
      current().histories[0]?.messages.filter((m) => m.role === "tool"),
    ).toHaveLength(1);
  });

  it.each([
    { childId: "", parentToolUseId: "" },
    { childId: "", parentToolUseId: "root-parent" },
    { childId: "root-child", parentToolUseId: "" },
  ])(
    "keeps root interrupts outside real child histories with metadata %j",
    async (rootMetadata) => {
      const { agent, play, current, handler } = setup();
      const histories = [
        savedHistory(["leaf0"], "parent0"),
        savedHistory(["leaf1"], "parent1"),
      ];
      for (const history of histories) history.runs[0]!.messages = [];
      await play(snapshot(...histories));
      expect(current().histories.map((history) => history.messages)).toEqual([
        [],
        [],
      ]);

      const calls = [
        { id: "root-read", ...rootMetadata },
        { id: "child-read0", childId: "leaf0", parentToolUseId: "parent0" },
        { id: "child-read1", childId: "leaf1", parentToolUseId: "parent1" },
      ];
      const interrupt: RunFinishedEvent = {
        type: EventType.RUN_FINISHED,
        threadId: agent.threadId,
        runId: "mixed-root-child",
        outcome: {
          type: "interrupt",
          interrupts: calls.map(({ id, ...metadata }) => ({
            id,
            toolCallId: id,
            reason: "tool_call",
            metadata: {
              source: "claude-sdk-native-child",
              ...metadata,
              toolName: "Read",
              input: { file_path: "/saved/example.txt" },
            },
          })),
        },
      };
      await play(interrupt);
      agent.events = calls.map((call) => ({
        ...result(call.parentToolUseId, call.id),
        rawEvent: {
          parent_tool_use_id:
            call.id === "root-read" ? null : call.parentToolUseId,
          is_error: false,
        },
      }));
      await agent.runAgent({
        resume: calls.map(({ id }) => ({
          interruptId: id,
          status: "resolved",
          payload: true,
        })),
      });

      expect(current().histories.map((history) => history.namespace)).toEqual([
        ["leaf0"],
        ["leaf1"],
      ]);
      expect(
        current().histories.map((history) => history.parentToolCallIds),
      ).toEqual([["parent0"], ["parent1"]]);
      for (const [index, history] of current().histories.entries()) {
        expect(history.messages).toHaveLength(2);
        expect(
          getAssistantMessage(history.messages[0]!).toolCalls?.map(
            (call) => call.id,
          ),
        ).toEqual([`child-read${index}`]);
        expect(getToolMessage(history.messages[1]!).toolCallId).toBe(
          `child-read${index}`,
        );
        expect(getToolMessage(history.messages[1]!).content).toContain(
          '"status":"displayed"',
        );
      }
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it("extends ownership when the same native child resumes under a new parent call", async () => {
    const { agent, play, current } = setup();
    await play(snapshot(savedHistory()));
    const interrupt: RunFinishedEvent = {
      type: EventType.RUN_FINISHED,
      threadId: agent.threadId,
      runId: "resume-child",
      outcome: {
        type: "interrupt",
        interrupts: [
          {
            id: "later-call",
            toolCallId: "later-call",
            reason: "tool_call",
            metadata: {
              source: "claude-sdk-native-child",
              childId: "research",
              parentToolUseId: "resume-delegate",
              toolName: "mcp__ag_ui__chart",
              input: { value: 9 },
            },
          },
        ],
      },
    };
    await play(interrupt);
    expect(current().histories).toHaveLength(1);
    expect(current().histories[0]?.namespace).toEqual(["research"]);
    expect(current().histories[0]?.parentToolCallIds).toEqual([
      "delegate",
      "resume-delegate",
    ]);
    agent.events = [result("resume-delegate", "later-call")];
    await agent.runAgent({
      resume: [
        { interruptId: "later-call", status: "resolved", payload: true },
      ],
    });
    expect(
      current()
        .histories[0]?.messages.filter((message) => message.role === "tool")
        .map((message) => message.toolCallId),
    ).toEqual(["later-call"]);
  });

  it("isolates threads and agents and clears removed agents", async () => {
    const { agent, core, play, current } = setup();
    await play(snapshot(savedHistory()));
    const originalThread = agent.threadId;
    agent.threadId = "thread-two";
    expect(current().histories).toEqual([]);
    await play(snapshot(savedHistory(["second"])));
    expect(
      core.ɵchildHistories.get(agent, originalThread).histories[0]?.namespace,
    ).toEqual(["research"]);
    const replacement = new ChildReplayAgent(agent.agentId, originalThread);
    expect(
      core.ɵchildHistories.get(replacement, originalThread).histories,
    ).toEqual([]);
    core.removeAgent__unsafe_dev_only(agent.agentId!);
    await Promise.resolve();
    expect(core.ɵchildHistories.get(agent, originalThread).histories).toEqual(
      [],
    );
    expect(current().histories).toEqual([]);
  });

  it("preserves separate normalized results sharing one native source message ID", async () => {
    const { play, current } = setup();
    await play(
      historyEvent({
        version: 1,
        histories: [
          {
            namespace: ["research"],
            parentToolCallIds: ["delegate"],
            runs: [
              {
                sourceRunId: "native-run",
                messages: [
                  {
                    sourceMessageId: "results-envelope",
                    role: "tool",
                    toolCallId: "first",
                    content: [{ type: "text", text: "first result" }],
                  },
                  {
                    sourceMessageId: "results-envelope",
                    role: "tool",
                    toolCallId: "second",
                    content: [{ type: "text", text: "second result" }],
                  },
                  {
                    sourceMessageId: "results-envelope",
                    role: "user",
                    content: [
                      { type: "text", text: "Continue from these results" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(current().histories[0]?.messages.map((m) => m.content)).toEqual([
      "first result",
      "second result",
      "Continue from these results",
    ]);
    expect(
      new Set(current().histories[0]?.messages.map((m) => m.id)).size,
    ).toBe(3);
  });

  it("merges split native assistant envelopes without losing earlier calls or duplicating replay", async () => {
    const { play, current } = setup();
    await play(snapshot(savedHistory()));
    const first: CustomEvent = {
      type: EventType.CUSTOM,
      name: "claude:assistant_content",
      value: {
        messageId: "native-live",
        uuid: "part-one",
        parentToolUseId: "delegate",
        content: [
          {
            type: "tool_use",
            id: "followup-one",
            name: "mcp__ag_ui__chart",
            input: { value: 8 },
          },
        ],
      },
    };
    const second: CustomEvent = {
      type: EventType.CUSTOM,
      name: "claude:assistant_content",
      value: {
        messageId: "native-live",
        uuid: "part-two",
        parentToolUseId: "delegate",
        content: [
          {
            type: "tool_use",
            id: "followup-two",
            name: "mcp__ag_ui__chart",
            input: { value: 9 },
          },
        ],
      },
    };
    await play(first, second, first, second);
    const live = current().histories[0]?.messages.find(
      (m) => m.id === "native-live",
    );
    expect(getAssistantMessage(live).toolCalls?.map((c) => c.id)).toEqual([
      "followup-one",
      "followup-two",
    ]);
    expect(current().histories[0]?.rootMessageIds).toEqual(["native-live"]);
  });

  it("does not merge live envelopes with the same message ID across child owners", async () => {
    const { play, current } = setup();
    await play(
      snapshot(
        savedHistory(["left"], "left-parent"),
        savedHistory(["right"], "right-parent"),
      ),
    );
    for (const parent of ["left-parent", "right-parent"]) {
      const event: CustomEvent = {
        type: EventType.CUSTOM,
        name: "claude:assistant_content",
        value: {
          messageId: "shared-native-id",
          uuid: `${parent}-envelope`,
          parentToolUseId: parent,
          content: [
            {
              type: "tool_use",
              id: `${parent}-call`,
              name: "mcp__ag_ui__chart",
              input: { value: 8 },
            },
          ],
        },
      };
      await play(event);
    }
    expect(
      current().histories.map((h) =>
        getAssistantMessage(
          h.messages.find((m) => m.id === "shared-native-id"),
        ).toolCalls?.map((c) => c.id),
      ),
    ).toEqual([["left-parent-call"], ["right-parent-call"]]);
  });
});
