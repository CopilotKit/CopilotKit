import { AbstractAgent, EventType, HttpAgent } from "@ag-ui/client";
import type { Message, RunAgentInput } from "@ag-ui/client";
import { of } from "rxjs";
import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { CopilotKitCore, CopilotKitCoreErrorCode } from "../core";
import type { FrontendToolHandlerContext } from "../types";
import {
  createTool,
  createMultipleToolCallsMessage,
  getAssistantMessage,
  createToolCallMessage,
  createToolResultMessage,
} from "./test-utils";

/** Replay durable snapshots and capture subsequent requests without a backend. */
class ReplayAgent extends AbstractAgent {
  readonly runs: RunAgentInput[] = [];
  runMessages: Message[] = [];
  readonly connections: RunAgentInput[] = [];
  constructor(public replayMessages: Message[]) {
    super({ agentId: "test", threadId: "thread-1" });
  }
  protected connect(input: RunAgentInput) {
    this.connections.push(input);
    return of(
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
      { type: EventType.MESSAGES_SNAPSHOT, messages: this.replayMessages },
      {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      },
    );
  }
  run(input: RunAgentInput) {
    this.runs.push(input);
    return of(
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
      ...(this.runMessages.length
        ? [{ type: EventType.MESSAGES_SNAPSHOT, messages: this.runMessages }]
        : []),
      {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      },
    );
  }
}

/** Create an isolated pending approval and its original call ID. */
function setup() {
  const core = new CopilotKitCore({});
  const message = createToolCallMessage("approval", { topic: "sales" });
  if (message.role !== "assistant" || !message.toolCalls?.[0])
    throw new Error("Missing tool call");
  const toolCallId = message.toolCalls[0].id;
  const agent = new ReplayAgent([message]);
  return { core, agent, message, toolCallId };
}

/** Keep approval completion under the test’s control. */
function deferredAnswer() {
  let resolve!: (answer: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("reconnect respects user turn boundaries", () => {
  it("does not follow up when a new user turn arrives during the framework flush", async () => {
    const { core, agent } = setup();
    const flush = deferredAnswer();
    const scheduler = vi
      .spyOn(core, "waitForPendingFrameworkUpdates")
      .mockImplementation(async () => {
        await flush.promise;
      });
    core.addTool(
      createTool({ name: "approval", handler: undefined, followUp: true }),
    );
    await core.connectAgent({ agent });
    await vi.waitFor(() => expect(scheduler).toHaveBeenCalledTimes(1));
    expect(
      agent.messages.filter((message) => message.role === "tool"),
    ).toHaveLength(1);
    const history: Message[] = [
      ...agent.messages,
      { id: "moved-on", role: "user", content: "never mind" },
    ];
    agent.setMessages(structuredClone(history));
    flush.resolve("flushed");
    await setImmediate();
    expect(agent.messages).toEqual(history);
    expect(agent.runs).toHaveLength(0);
  });

  it.each([
    ["component", "chart"],
    ["component", "*"],
    ["resume-pending", "chart"],
    ["resume-pending", "*"],
    ["human-in-the-loop", "chart"],
    ["human-in-the-loop", "*"],
  ])(
    "leaves historical %s calls registered as %s untouched",
    async (kind, name) => {
      const handler = vi.fn(async () => "answer");
      const core = new CopilotKitCore({});
      core.addTool(
        createTool({
          name,
          handler: kind === "component" ? undefined : handler,
          type: kind === "human-in-the-loop" ? "human-in-the-loop" : "frontend",
          reconnectBehavior: "resume-pending",
          followUp: true,
        }),
      );
      const history: Message[] = [
        { id: "request-chart", role: "user", content: "draw a chart" },
        createToolCallMessage("chart", {}),
        { id: "changed-mind", role: "user", content: "never mind, 2+2?" },
      ];
      const agent = new ReplayAgent(structuredClone(history));
      // A later user message is sufficient even before its assistant reply.
      await core.connectAgent({ agent });
      await setImmediate();
      expect(agent.messages).toEqual(history);
      expect(handler).not.toHaveBeenCalled();
      expect(agent.runs).toHaveLength(0);

      history.push({ id: "answer", role: "assistant", content: "4" });
      agent.replayMessages = structuredClone(history);
      await core.connectAgent({ agent });
      await setImmediate();
      expect(agent.messages).toEqual(history);
      expect(handler).not.toHaveBeenCalled();
      expect(agent.runs).toHaveLength(0);
    },
  );

  it("restores all assistant messages in the latest turn while ignoring old calls", async () => {
    const old = createToolCallMessage("chart", {});
    const chart = getAssistantMessage(createToolCallMessage("chart", {}));
    const approval = getAssistantMessage(createToolCallMessage("approval", {}));
    const answer = deferredAnswer();
    const handler = vi.fn(() => answer.promise);
    const core = new CopilotKitCore({});
    core.addTool(
      createTool({ name: "chart", handler: undefined, followUp: true }),
    );
    core.addTool(
      createTool({
        name: "approval",
        type: "human-in-the-loop",
        handler,
        followUp: true,
      }),
    );
    const history: Message[] = [
      old,
      {
        id: "latest-request",
        role: "user",
        content: "another chart, then approval",
      },
      chart,
      approval,
    ];
    const agent = new ReplayAgent(structuredClone(history));
    await core.connectAgent({ agent });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(agent.runs).toHaveLength(0);
    answer.resolve("approved");
    await vi.waitFor(() => expect(agent.runs).toHaveLength(1));
    expect(agent.messages.filter((message) => message.role === "tool")).toEqual(
      [
        expect.objectContaining({
          toolCallId: chart.toolCalls?.[0]?.id,
          content: "",
        }),
        expect.objectContaining({
          toolCallId: approval.toolCalls?.[0]?.id,
          content: "approved",
        }),
      ],
    );
  });

  it.each(["approval", "*"])(
    "discards a pending replay answer after a new user turn (%s)",
    async (name) => {
      const { core, agent } = setup();
      const answer = deferredAnswer();
      const handler = vi.fn(() => answer.promise);
      core.addTool(
        createTool({
          name,
          handler,
          reconnectBehavior: "resume-pending",
          followUp: true,
        }),
      );
      await core.connectAgent({ agent });
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
      const history: Message[] = [
        ...agent.messages,
        { id: "moved-on", role: "user", content: "never mind" },
      ];
      agent.setMessages(structuredClone(history));
      answer.resolve("stale answer");
      await setImmediate();
      expect(agent.messages).toEqual(history);
      expect(agent.runs).toHaveLength(0);
    },
  );
});

// PNI-678: component results remain local while an approval is pending.
describe("restoring component completions alongside an approval", () => {
  /** Model two local chart completions followed by a pending approval. */
  function setupComponents(savedMessages?: Message[]) {
    const message = getAssistantMessage(
      createMultipleToolCallsMessage([
        { name: "pieChart", args: { apples: 30, pears: 70 } },
        { name: "barChart", args: { monday: 4, tuesday: 8 } },
        { name: "approval", args: { topic: "meeting" } },
      ]),
    );
    const history = savedMessages ?? [message];
    const answer = deferredAnswer();
    const handler = vi.fn(() => answer.promise);
    const core = new CopilotKitCore({});
    for (const name of ["pieChart", "barChart"]) {
      core.addTool(createTool({ name, handler: undefined, followUp: true }));
    }
    core.addTool(
      createTool({
        name: "approval",
        type: "human-in-the-loop",
        handler,
        followUp: true,
      }),
    );
    const agent = new ReplayAgent(structuredClone(history));
    return { core, agent, history, answer, handler };
  }

  /** Assert result order, original IDs, and the absence of replacement cards. */
  function expectOriginalResults(messages: Message[], history: Message[]) {
    const calls = history.flatMap((message) =>
      message.role === "assistant" ? (message.toolCalls ?? []) : [],
    );
    expect(
      messages
        .filter((message) => message.role === "tool")
        .map((message) => ({
          toolCallId: message.toolCallId,
          content: message.content,
        })),
    ).toEqual(
      calls.map((call) => ({
        toolCallId: call.id,
        content: call.function.name === "approval" ? "Tuesday at 2" : "",
      })),
    );
    // No replacement calls or duplicated assistant messages/cards.
    expect(messages.filter((message) => message.role === "assistant")).toEqual(
      history,
    );
  }

  it.each(["live", "reopen"])(
    "%s sends both original chart completions with the approval answer",
    async (mode) => {
      const { core, agent, history, answer, handler } = setupComponents();
      let running: Promise<unknown> | undefined;
      if (mode === "live") {
        agent.runMessages = structuredClone(history);
        running = core.runAgent({ agent });
      } else {
        await core.connectAgent({ agent });
      }
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
      expect(
        agent.messages.filter((message) => message.role === "tool"),
      ).toHaveLength(2);
      expect(agent.runs).toHaveLength(mode === "live" ? 1 : 0);
      agent.runMessages = [];
      answer.resolve("Tuesday at 2");
      await running;
      await vi.waitFor(() =>
        expect(agent.runs).toHaveLength(mode === "live" ? 2 : 1),
      );
      expectOriginalResults(agent.runs.at(-1)!.messages, history);
    },
  );

  it("recovers after repeated reopening, then leaves all saved results completed", async () => {
    const original = setupComponents();
    for (let reopen = 0; reopen < 2; reopen++) {
      // A fresh browser has only durable history, without local chart results.
      const { core, agent, answer, handler } = setupComponents(
        original.history,
      );
      await core.connectAgent({ agent });
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
      expect(
        agent.messages.filter((message) => message.role === "tool"),
      ).toHaveLength(2);
      expect(agent.runs).toHaveLength(0);
      answer.resolve("Tuesday at 2");
      await vi.waitFor(() => expect(agent.runs).toHaveLength(1));
      expectOriginalResults(agent.runs[0]!.messages, original.history);

      const saved = structuredClone(agent.runs[0]!.messages);
      const completed = setupComponents(saved);
      await completed.core.connectAgent({ agent: completed.agent });
      await setImmediate();
      expect(completed.handler).not.toHaveBeenCalled();
      expect(completed.agent.runs).toHaveLength(0);
      expect(completed.agent.messages).toEqual(saved);
    }
  });

  it("fills only missing chart results when the approval and another chart are saved", async () => {
    const original = setupComponents();
    const calls = getAssistantMessage(original.history[0]).toolCalls!;
    const saved = [
      ...original.history,
      createToolResultMessage(calls[0]!.id, ""),
      createToolResultMessage(calls[2]!.id, "Tuesday at 2"),
    ];
    const { core, agent, handler } = setupComponents(saved);
    await core.connectAgent({ agent });
    await vi.waitFor(() => expect(agent.runs).toHaveLength(1));
    expect(handler).not.toHaveBeenCalled();
    expect(agent.runs[0]!.messages).toEqual([
      saved[0],
      saved[1],
      expect.objectContaining({
        role: "tool",
        toolCallId: calls[1]!.id,
        content: "",
      }),
      saved[2],
    ]);
  });

  it.each(["specific", "wildcard"])(
    "replaces a restored handlerless placeholder (%s)",
    async (registration) => {
      const { core, agent, toolCallId } = setup();
      core.addTool(
        createTool({
          name: registration === "wildcard" ? "*" : "approval",
          handler: undefined,
          followUp: true,
        }),
      );
      agent.replayMessages.push(
        createToolResultMessage(toolCallId, "Forwarded to client"),
      );
      await core.connectAgent({ agent });
      await vi.waitFor(() => expect(agent.runs).toHaveLength(1));
      expect(
        agent.runs[0]!.messages.filter((message) => message.role === "tool"),
      ).toEqual([expect.objectContaining({ toolCallId, content: "" })]);
      agent.replayMessages = structuredClone(agent.messages);
      await core.connectAgent({ agent });
      await setImmediate();
      expect(agent.runs).toHaveLength(1);
    },
  );

  it("inserts a wildcard result before later saved results without changing them", async () => {
    const message = getAssistantMessage(
      createMultipleToolCallsMessage([
        { name: "first", args: {} },
        { name: "middle", args: {} },
        { name: "last", args: {} },
      ]),
    );
    const calls = message.toolCalls!;
    const first = createToolResultMessage(calls[0]!.id, "saved first");
    const last = createToolResultMessage(calls[2]!.id, "saved last");
    const agent = new ReplayAgent([message, first, last]);
    const core = new CopilotKitCore({});
    core.addTool(createTool({ name: "*", handler: undefined, followUp: true }));
    await core.connectAgent({ agent });
    await vi.waitFor(() => expect(agent.runs).toHaveLength(1));
    expect(agent.runs[0]!.messages).toEqual([
      message,
      first,
      expect.objectContaining({
        role: "tool",
        toolCallId: calls[1]!.id,
        content: "",
      }),
      last,
    ]);
  });

  it.each([true, false])(
    "honors handlerless followUp=%s without completing unknown tools",
    async (followUp) => {
      const { core, agent } = setup();
      core.addTool(
        createTool({ name: "approval", handler: undefined, followUp }),
      );
      agent.replayMessages.push(createToolCallMessage("unknownBackendTool"));
      await core.connectAgent({ agent });
      await vi.waitFor(() =>
        expect(
          agent.messages.filter((message) => message.role === "tool"),
        ).toHaveLength(1),
      );
      await setImmediate();
      expect(agent.runs).toHaveLength(followUp ? 1 : 0);
    },
  );

  it("restores a handlerless wildcard result using the original call ID", async () => {
    const { core, agent, toolCallId } = setup();
    core.addTool(createTool({ name: "*", handler: undefined, followUp: true }));
    await core.connectAgent({ agent });
    await vi.waitFor(() => expect(agent.runs).toHaveLength(1));
    expect(
      agent.runs[0]!.messages.filter((message) => message.role === "tool"),
    ).toEqual([expect.objectContaining({ toolCallId, content: "" })]);
  });
});

describe("CopilotKitCore.connectAgent selective replay", () => {
  it.each([undefined, "frontend"] as const)(
    "leaves ordinary tools passive (type=%s)",
    async (type) => {
      const { core, agent } = setup();
      const handler = vi.fn(async () => "side effect");
      core.addTool(createTool({ name: "approval", type, handler }));
      await core.connectAgent({ agent });
      // The restore pass runs after connectAgent resolves; let it run before
      // asserting that it did nothing.
      await setImmediate();
      expect(handler).not.toHaveBeenCalled();
      expect(agent.runs).toHaveLength(0);
    },
  );

  it.each(["approval", "*"])(
    "restores pending HITL registered as %s and continues with its answer",
    async (name) => {
      const { core, agent, toolCallId } = setup();
      const answer = deferredAnswer();
      const handler = vi.fn(() => answer.promise);
      core.addTool(
        createTool({
          name,
          type: "human-in-the-loop",
          handler,
          followUp: true,
        }),
      );
      const connected = core.connectAgent({ agent });
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
      expect(agent.runs).toHaveLength(0);
      await connected; // History restoration must finish before the user answers.
      answer.resolve("Tuesday at 2");
      await vi.waitFor(() => expect(agent.runs).toHaveLength(1));
      expect(agent.runs[0]?.messages).toContainEqual(
        expect.objectContaining({
          role: "tool",
          toolCallId,
          content: "Tuesday at 2",
        }),
      );
    },
  );

  it("does not reopen completed HITL or execute ordinary tools alongside pending HITL", async () => {
    const { core, agent, toolCallId } = setup();
    agent.replayMessages.push(
      createToolResultMessage(toolCallId, "Already answered"),
      createToolCallMessage("ordinary"),
      createToolCallMessage("pending"),
    );
    const completed = vi.fn(async () => "wrong");
    const ordinary = vi.fn(async () => "side effect");
    const pending = vi.fn(async () => "answer");
    core.addTool(
      createTool({
        name: "approval",
        type: "human-in-the-loop",
        handler: completed,
      }),
    );
    core.addTool(createTool({ name: "ordinary", handler: ordinary }));
    core.addTool(
      createTool({
        name: "pending",
        type: "human-in-the-loop",
        handler: pending,
        followUp: false,
      }),
    );
    await core.connectAgent({ agent });
    expect(completed).not.toHaveBeenCalled();
    expect(ordinary).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(pending).toHaveBeenCalledTimes(1));
  });

  it("does not start the same pending handler twice on reconnect", async () => {
    const { core, agent } = setup();
    const answer = deferredAnswer();
    const handler = vi.fn(() => answer.promise);
    core.addTool(
      createTool({
        name: "approval",
        type: "human-in-the-loop",
        handler,
        followUp: false,
      }),
    );
    const first = core.connectAgent({ agent });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    await core.connectAgent({ agent });
    // Let the second restore pass run before asserting it started nothing.
    await setImmediate();
    expect(handler).toHaveBeenCalledTimes(1);
    answer.resolve("yes");
    await first;
  });

  it("keeps multiple HITL calls sequential across reconnects", async () => {
    const { core, agent } = setup();
    agent.replayMessages.push(
      createToolCallMessage("approval", { topic: "support" }),
    );
    const first = deferredAnswer();
    const second = deferredAnswer();
    const handler = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    core.addTool(
      createTool({
        name: "approval",
        type: "human-in-the-loop",
        handler,
        followUp: false,
      }),
    );
    await core.connectAgent({ agent });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    // A full snapshot may be delivered again even when the cursor is unchanged.
    vi.spyOn(agent, "connectAgent").mockResolvedValueOnce({
      result: undefined,
      newMessages: [...agent.replayMessages],
    });
    await core.connectAgent({ agent });
    await setImmediate(); // Let the detached restoration reach its handler.
    expect(handler).toHaveBeenCalledTimes(1);
    first.resolve("sales approved");
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
    second.resolve("support approved");
    await vi.waitFor(() =>
      expect(agent.messages.filter((m) => m.role === "tool")).toHaveLength(2),
    );
  });

  it("does not continue a different thread when an old approval resolves", async () => {
    const { core, agent } = setup();
    const answer = deferredAnswer();
    const handler = vi.fn(() => answer.promise);
    core.addTool(
      createTool({
        name: "approval",
        type: "human-in-the-loop",
        handler,
        followUp: true,
      }),
    );
    const connected = core.connectAgent({ agent });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    agent.threadId = "thread-2";
    const ended = vi.fn();
    core.subscribe({ onToolExecutionEnd: ended });
    answer.resolve("yes");
    await connected;
    await vi.waitFor(() => expect(ended).toHaveBeenCalledTimes(1));
    expect(agent.messages.some((m) => m.role === "tool")).toBe(false);
    expect(agent.runs).toHaveLength(0);
  });

  it.each(["replay", "live"])(
    "recreates the %s response resolver after switching A to B to A",
    async (source) => {
      const { core, agent, message, toolCallId } = setup();
      const onError = vi.fn();
      core.subscribe({ onError });
      let respond: ((value: string) => void) | undefined;
      // React/Vue HITL hooks hold one resolver per mounted registration.
      const handler = vi.fn(
        (_args, context) =>
          new Promise<string>((resolve, reject) => {
            respond = resolve;
            context?.signal?.addEventListener(
              "abort",
              () => {
                respond = undefined;
                reject(new Error("Human-in-the-loop interaction aborted"));
              },
              { once: true },
            );
          }),
      );
      core.addTool(
        createTool({
          name: "approval",
          type: "human-in-the-loop",
          handler,
          followUp: false,
        }),
      );
      agent.runMessages = [message];
      const initial =
        source === "live"
          ? core.runAgent({ agent })
          : core.connectAgent({ agent });
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
      agent.threadId = "thread-2";
      agent.replayMessages = [
        createToolCallMessage("approval", { topic: "support" }),
      ];
      await core.connectAgent({ agent });
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
      expect(handler.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      if (source === "live") {
        // B's completed replay removes its controller group. A must still be
        // restartable even when there is no previous replay left to cancel.
        respond?.("support approved");
        await vi.waitFor(() =>
          expect(agent.messages).toContainEqual(
            expect.objectContaining({
              role: "tool",
              content: "support approved",
            }),
          ),
        );
        await setImmediate();
      }
      agent.threadId = "thread-1";
      agent.replayMessages = [message];
      await core.connectAgent({ agent });
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(3));
      respond?.("sales approved");
      await vi.waitFor(() =>
        expect(agent.messages).toContainEqual(
          expect.objectContaining({
            role: "tool",
            toolCallId,
            content: "sales approved",
          }),
        ),
      );
      expect(agent.messages.filter((m) => m.role === "tool")).toHaveLength(1);
      await initial;
      expect(onError).not.toHaveBeenCalled();
    },
  );

  it("keeps classification out of the agent tool schema", async () => {
    const { core, agent } = setup();
    core.addTool(
      createTool({
        name: "approval",
        type: "human-in-the-loop",
        handler: async () => "yes",
      }),
    );
    await core.connectAgent({ agent });
    expect(agent.connections[0]?.tools[0]).toMatchObject({ name: "approval" });
    expect(agent.connections[0]?.tools[0]).not.toHaveProperty("type");
  });

  it("restores HITL with a fresh signal after an earlier run was stopped", async () => {
    const { core, agent } = setup();
    await core.runAgent({ agent });
    core.stopAgent({ agent });
    const handler = vi.fn(async (_args, context) => {
      expect(context?.signal?.aborted).toBe(false);
      return "yes";
    });
    core.addTool(
      createTool({
        name: "approval",
        type: "human-in-the-loop",
        handler,
        followUp: true,
      }),
    );
    await core.connectAgent({ agent });
    await vi.waitFor(() => expect(agent.runs).toHaveLength(2));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["replay", "success", "approval"],
    ["live", "success", "approval"],
    ["replay", "error", "approval"],
    ["live", "error", "approval"],
    ["live", "error", "*"],
  ])(
    "restores a stopped %s interaction after a late %s from %s",
    async (source, lateResult, name) => {
      const { core, agent, message, toolCallId } = setup();
      const stale = deferredAnswer();
      const fresh = deferredAnswer();
      const handler = vi
        .fn()
        .mockImplementationOnce(() => stale.promise)
        .mockImplementationOnce(() => fresh.promise);
      core.addTool(
        createTool({
          name,
          type: "human-in-the-loop",
          handler,
          followUp: false,
        }),
      );
      agent.runMessages = [message];
      const initial =
        source === "live"
          ? core.runAgent({ agent })
          : core.connectAgent({ agent });
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
      core.stopAgent({ agent });
      await core.connectAgent({ agent });
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));

      // The old handler can settle late without answering the restored call
      // or removing the fresh execution's duplicate-prevention marker.
      if (lateResult === "error")
        stale.reject(new Error("Human-in-the-loop interaction aborted"));
      else stale.resolve("stale answer");
      await initial;
      await setImmediate();
      expect(agent.messages.some((entry) => entry.role === "tool")).toBe(false);
      await core.connectAgent({ agent });
      expect(handler).toHaveBeenCalledTimes(2);
      fresh.resolve("fresh answer");
      await vi.waitFor(() =>
        expect(agent.messages).toContainEqual(
          expect.objectContaining({
            role: "tool",
            toolCallId,
            content: "fresh answer",
          }),
        ),
      );
      expect(
        agent.messages.filter((entry) => entry.role === "tool"),
      ).toHaveLength(1);
    },
  );

  it.each([
    ["approval", "stopAgent"],
    ["*", "stopAgent"],
    ["approval", "abortRun"],
    ["*", "abortRun"],
  ])(
    "records the live %s HITL cancellation result via %s without reconnect",
    async (name, stop) => {
      const { core, message, toolCallId } = setup();
      const agent = new HttpAgent({
        url: "http://localhost/unused",
        agentId: "test",
        threadId: "thread-1",
      });
      const run = vi
        .spyOn(agent, "runAgent")
        .mockImplementationOnce(async () => {
          agent.setMessages([message]);
          return { result: undefined, newMessages: [message] };
        });
      const onError = vi.fn();
      core.subscribe({ onError });
      const handler = vi.fn(
        (_args, context) =>
          new Promise<string>((_resolve, reject) => {
            context.signal.addEventListener(
              "abort",
              () => reject(new Error("Human-in-the-loop interaction aborted")),
              { once: true },
            );
          }),
      );
      core.addTool(
        createTool({
          name,
          type: "human-in-the-loop",
          handler,
          followUp: true,
        }),
      );
      const running = core.runAgent({ agent });
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
      if (stop === "stopAgent") core.stopAgent({ agent });
      else agent.abortRun();
      await running;
      expect(agent.messages).toContainEqual(
        expect.objectContaining({
          role: "tool",
          toolCallId,
          content: "Error: Human-in-the-loop interaction aborted",
        }),
      );
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: CopilotKitCoreErrorCode.TOOL_HANDLER_FAILED,
        }),
      );
      expect(run).toHaveBeenCalledTimes(1);
    },
  );

  it("records a live stop result even when AbortSignal has no reason", async () => {
    // React Native installs the `abort-controller@3` polyfill as the global
    // AbortController. Its `abort()` takes no reason and its signals never
    // expose one, so the stop must not be signalled through `signal.reason`.
    const reason = Object.getOwnPropertyDescriptor(
      AbortSignal.prototype,
      "reason",
    );
    if (!reason) throw new Error("AbortSignal.reason is not defined here");
    Object.defineProperty(AbortSignal.prototype, "reason", {
      configurable: true,
      get: () => undefined,
    });
    try {
      const { core, message, toolCallId } = setup();
      const agent = new HttpAgent({
        url: "http://localhost/unused",
        agentId: "test",
        threadId: "thread-1",
      });
      vi.spyOn(agent, "runAgent").mockImplementationOnce(async () => {
        agent.setMessages([message]);
        return { result: undefined, newMessages: [message] };
      });
      const handler = vi.fn(
        (_args, context) =>
          new Promise<string>((_resolve, reject) => {
            context.signal.addEventListener(
              "abort",
              () => reject(new Error("Human-in-the-loop interaction aborted")),
              { once: true },
            );
          }),
      );
      core.addTool(
        createTool({
          name: "approval",
          type: "human-in-the-loop",
          handler,
          followUp: true,
        }),
      );
      const running = core.runAgent({ agent });
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
      expect(handler.mock.calls[0]?.[1]?.signal?.reason).toBeUndefined();
      core.stopAgent({ agent });
      await running;
      expect(agent.messages).toContainEqual(
        expect.objectContaining({
          role: "tool",
          toolCallId,
          content: "Error: Human-in-the-loop interaction aborted",
        }),
      );
    } finally {
      Object.defineProperty(AbortSignal.prototype, "reason", reason);
    }
  });

  it("does not submit a second answer after another client answered", async () => {
    const { core, agent, toolCallId } = setup();
    const answer = deferredAnswer();
    const handler = vi.fn(() => answer.promise);
    const ended = vi.fn();
    core.subscribe({ onToolExecutionEnd: ended });
    core.addTool(
      createTool({
        name: "approval",
        type: "human-in-the-loop",
        handler,
        followUp: true,
      }),
    );
    await core.connectAgent({ agent });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    agent.replayMessages = [
      ...agent.messages,
      createToolResultMessage(toolCallId, "remote answer"),
    ];
    await core.connectAgent({ agent });
    answer.resolve("local answer");
    await vi.waitFor(() => expect(ended).toHaveBeenCalledTimes(1));
    expect(agent.messages.filter((m) => m.role === "tool")).toEqual([
      expect.objectContaining({ toolCallId, content: "remote answer" }),
    ]);
    expect(agent.runs).toHaveLength(0);
  });

  it.each([false, true])(
    "restores the next prompt after a remote answer (already known: %s)",
    async (alreadyKnown) => {
      const { core, agent, toolCallId } = setup();
      const nextPrompt = createToolCallMessage("approval", {
        topic: "support",
      });
      if (alreadyKnown) agent.replayMessages.push(nextPrompt);
      const first = deferredAnswer();
      const second = deferredAnswer();
      const handler = vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise);
      core.addTool(
        createTool({
          name: "approval",
          type: "human-in-the-loop",
          handler,
          followUp: false,
        }),
      );
      await core.connectAgent({ agent });
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
      agent.replayMessages = [
        ...agent.messages,
        createToolResultMessage(toolCallId, "remote answer"),
        ...(alreadyKnown ? [] : [nextPrompt]),
      ];
      const replay = await core.connectAgent({ agent });
      if (alreadyKnown) {
        expect(
          replay.newMessages.some((message) => message.id === nextPrompt.id),
        ).toBe(false);
      }
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
      first.resolve("stale answer");
      second.resolve("support approved");
      await vi.waitFor(() =>
        expect(agent.messages.filter((m) => m.role === "tool")).toHaveLength(2),
      );
      expect(
        agent.messages.filter((m) => m.role === "tool").map((m) => m.content),
      ).toEqual(["remote answer", "support approved"]);
    },
  );

  it("stopping one agent leaves another agent's replay answerable", async () => {
    const { core, agent } = setup();
    const otherMessage = createToolCallMessage("approval", {
      topic: "support",
    });
    const other = new ReplayAgent([otherMessage]);
    other.agentId = "other";
    const first = deferredAnswer();
    const second = deferredAnswer();
    const signals = new Map<AbstractAgent, AbortSignal | undefined>();
    const handler = vi.fn((_args, context) => {
      signals.set(context.agent, context.signal);
      return context.agent === agent ? first.promise : second.promise;
    });
    core.addTool(
      createTool({
        name: "approval",
        type: "human-in-the-loop",
        handler,
        followUp: true,
      }),
    );
    await core.connectAgent({ agent });
    await core.connectAgent({ agent: other });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
    core.stopAgent({ agent });
    expect(signals.get(agent)?.aborted).toBe(true);
    expect(signals.get(other)?.aborted).toBe(false);
    second.resolve("support approved");
    await vi.waitFor(() => expect(other.runs).toHaveLength(1));
    expect(other.runs[0]?.messages).toContainEqual(
      expect.objectContaining({ role: "tool", content: "support approved" }),
    );
    first.resolve("stopped answer");
    await setImmediate();
    expect(agent.runs).toHaveLength(0);
    expect(agent.messages.some((message) => message.role === "tool")).toBe(
      false,
    );
  });

  it("continues to execute ordinary tools during normal runs", async () => {
    const { core, agent } = setup();
    const handler = vi.fn(async () => "run result");
    core.addTool(createTool({ name: "approval", handler, followUp: false }));
    vi.spyOn(agent, "runAgent").mockImplementationOnce(async () => {
      agent.setMessages(agent.replayMessages);
      return { result: undefined, newMessages: agent.replayMessages };
    });
    await core.runAgent({ agent });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// #6101: an ordinary frontend tool can opt in to running its pending calls
// when history is restored, instead of leaving the thread stuck on them.
describe('CopilotKitCore.connectAgent with reconnectBehavior "resume-pending"', () => {
  it.each(["approval", "*"])(
    "runs the pending call of an opted-in tool registered as %s and continues with its result",
    async (name) => {
      const { core, agent, toolCallId } = setup();
      const handler = vi.fn(async () => "browser data");
      core.addTool(
        createTool({
          name,
          handler,
          followUp: true,
          reconnectBehavior: "resume-pending",
        }),
      );

      await core.connectAgent({ agent });

      await vi.waitFor(() => expect(agent.runs).toHaveLength(1));
      expect(handler).toHaveBeenCalledTimes(1);
      expect(agent.runs[0]?.messages).toContainEqual(
        expect.objectContaining({
          role: "tool",
          toolCallId,
          content: "browser data",
        }),
      );
    },
  );

  it("tells the handler that the call is a replay", async () => {
    const { core, agent } = setup();
    const handler = vi.fn(
      async (_args: unknown, _context: FrontendToolHandlerContext) => "ok",
    );
    core.addTool(
      createTool({
        name: "approval",
        handler,
        reconnectBehavior: "resume-pending",
      }),
    );

    await core.connectAgent({ agent });

    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(handler.mock.calls[0]?.[1]).toMatchObject({ isReplay: true });
  });

  it("does not mark a call from a live run as a replay", async () => {
    const { core, agent } = setup();
    const handler = vi.fn(
      async (_args: unknown, _context: FrontendToolHandlerContext) =>
        "run result",
    );
    core.addTool(
      createTool({
        name: "approval",
        handler,
        reconnectBehavior: "resume-pending",
      }),
    );
    vi.spyOn(agent, "runAgent").mockImplementationOnce(async () => {
      agent.setMessages(agent.replayMessages);
      return { result: undefined, newMessages: agent.replayMessages };
    });

    await core.runAgent({ agent });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[1]).not.toHaveProperty("isReplay");
  });

  it('leaves a tool with reconnectBehavior "passive" passive', async () => {
    const { core, agent } = setup();
    const handler = vi.fn(async () => "side effect");
    core.addTool(
      createTool({ name: "approval", handler, reconnectBehavior: "passive" }),
    );

    await core.connectAgent({ agent });
    await setImmediate();

    expect(handler).not.toHaveBeenCalled();
    expect(agent.runs).toHaveLength(0);
  });

  it("does not run a call that already has a result", async () => {
    const { core, agent, message, toolCallId } = setup();
    agent.replayMessages = [
      message,
      createToolResultMessage(toolCallId, "already answered"),
    ];
    const handler = vi.fn(async () => "again");
    core.addTool(
      createTool({
        name: "approval",
        handler,
        followUp: true,
        reconnectBehavior: "resume-pending",
      }),
    );

    await core.connectAgent({ agent });
    await setImmediate();

    expect(handler).not.toHaveBeenCalled();
    expect(agent.runs).toHaveLength(0);
  });

  it("records the result without a follow-up run when followUp is false", async () => {
    const { core, agent, toolCallId } = setup();
    const handler = vi.fn(async () => "browser data");
    core.addTool(
      createTool({
        name: "approval",
        handler,
        followUp: false,
        reconnectBehavior: "resume-pending",
      }),
    );

    await core.connectAgent({ agent });

    await vi.waitFor(() =>
      expect(agent.messages).toContainEqual(
        expect.objectContaining({
          role: "tool",
          toolCallId,
          content: "browser data",
        }),
      ),
    );
    await setImmediate();
    expect(agent.runs).toHaveLength(0);
  });

  it("does not start the same pending call twice on reconnect", async () => {
    const { core, agent } = setup();
    const result = deferredAnswer();
    const handler = vi.fn(() => result.promise);
    core.addTool(
      createTool({
        name: "approval",
        handler,
        followUp: false,
        reconnectBehavior: "resume-pending",
      }),
    );

    const first = core.connectAgent({ agent });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    await core.connectAgent({ agent });
    // The second restore pass reaches the handler only after connectAgent
    // resolves; let it run before asserting that it did not start the call.
    await setImmediate();

    expect(handler).toHaveBeenCalledTimes(1);
    result.resolve("done");
    await first;
  });
});
