import { AbstractAgent, EventType } from "@ag-ui/client";
import type { Message, RunAgentInput } from "@ag-ui/client";
import { of } from "rxjs";
import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { CopilotKitCore } from "../core";
import {
  createTool,
  createToolCallMessage,
  createToolResultMessage,
} from "./test-utils";

class ReplayAgent extends AbstractAgent {
  readonly runs: RunAgentInput[] = [];
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
      {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      },
    );
  }
}

function setup() {
  const core = new CopilotKitCore({});
  const message = createToolCallMessage("approval", { topic: "sales" });
  if (message.role !== "assistant" || !message.toolCalls?.[0])
    throw new Error("Missing tool call");
  const toolCallId = message.toolCalls[0].id;
  const agent = new ReplayAgent([message]);
  return { core, agent, message, toolCallId };
}

function deferredAnswer() {
  let resolve!: (answer: string) => void;
  const promise = new Promise<string>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("CopilotKitCore.connectAgent selective replay", () => {
  it.each([undefined, "frontend"] as const)(
    "leaves ordinary tools passive (type=%s)",
    async (type) => {
      const { core, agent } = setup();
      const handler = vi.fn(async () => "side effect");
      core.addTool(createTool({ name: "approval", type, handler }));
      await core.connectAgent({ agent });
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

  it("recreates the active response resolver after switching A to B to A", async () => {
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
    await core.connectAgent({ agent });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    agent.threadId = "thread-2";
    agent.replayMessages = [
      createToolCallMessage("approval", { topic: "support" }),
    ];
    await core.connectAgent({ agent });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
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
    expect(onError).not.toHaveBeenCalled();
  });

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
