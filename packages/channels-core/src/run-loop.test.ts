import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { runAgentLoop } from "./run-loop.js";
import { makeFakeRunRenderer } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";
import type {
  ChannelTool,
  AgentToolDescriptor,
  ContextEntry,
} from "./tools.js";
import type { AgentSubscriber } from "@ag-ui/client";
import type { CapturedInterrupt } from "./platform-adapter.js";

const toolDescriptors: AgentToolDescriptor[] = [];
const context: ContextEntry[] = [];

describe("runAgentLoop", () => {
  it("executes a frontend tool call and pushes the result, then terminates", async () => {
    const renderer = makeFakeRunRenderer();

    const recorded: Array<{ msg: string }> = [];
    const echo: ChannelTool = {
      name: "echo",
      description: "echo back",
      parameters: z.object({ msg: z.string() }),
      handler: (args) => {
        recorded.push(args as { msg: string });
        return { ok: true };
      },
    };
    const tools = new Map<string, ChannelTool>([["echo", echo]]);

    // Step 1: agent emits an `echo` tool call, then finishes.
    // Step 2: agent just finishes (no further tool calls) -> loop terminates.
    const agent = new FakeAgent([
      (sub: AgentSubscriber) => {
        sub.onToolCallEndEvent?.({
          event: { toolCallId: "t1" },
          toolCallName: "echo",
          toolCallArgs: { msg: "hi" },
        } as never);
        sub.onRunFinishedEvent?.({ event: {} } as never);
      },
      (sub: AgentSubscriber) => {
        sub.onRunFinishedEvent?.({ event: {} } as never);
      },
    ]);

    await runAgentLoop({
      agent,
      renderer,
      tools,
      toolDescriptors,
      context,
      makeToolCtx: () => ({
        thread: {} as never,
        user: null,
        actor: { id: "actor", kind: "unknown" as const },
        platform: "fake",
      }),
    });

    expect(recorded).toEqual([{ msg: "hi" }]);
    expect(agent.runAgentCalls).toBe(2);
    const toolResult = agent.messages.find((m) => m.role === "tool");
    expect(toolResult).toBeDefined();
    expect((toolResult as { toolCallId?: string }).toolCallId).toBe("t1");
  });

  it("keeps ordinary tool failures recoverable by the agent", async () => {
    const renderer = makeFakeRunRenderer();
    const tool: ChannelTool = {
      name: "recoverable",
      description: "Fail without closing the delivery.",
      parameters: z.object({}),
      handler: () => {
        throw new Error("try something else");
      },
    };
    const agent = new FakeAgent([
      (sub: AgentSubscriber) => {
        sub.onToolCallEndEvent?.({
          event: { toolCallId: "t1" },
          toolCallName: "recoverable",
          toolCallArgs: {},
        } as never);
        sub.onRunFinishedEvent?.({ event: {} } as never);
      },
      (sub: AgentSubscriber) => {
        sub.onRunFinishedEvent?.({ event: {} } as never);
      },
    ]);

    await runAgentLoop({
      agent,
      renderer,
      tools: new Map([["recoverable", tool]]),
      toolDescriptors,
      context,
      makeToolCtx: () => ({
        thread: {} as never,
        user: null,
        actor: { id: "actor", kind: "unknown" as const },
        platform: "fake",
      }),
    });

    expect(agent.runAgentCalls).toBe(2);
    expect(agent.messages.find(({ role }) => role === "tool")).toMatchObject({
      toolCallId: "t1",
      content: JSON.stringify({ error: "try something else" }),
    });
  });

  it("posts the picker via handleInterrupt and returns without running tools", async () => {
    const renderer = makeFakeRunRenderer();
    const tools = new Map<string, ChannelTool>();
    const handleInterrupt = vi.fn<(i: CapturedInterrupt) => void>();

    const agent = new FakeAgent([
      (sub: AgentSubscriber) => {
        sub.onCustomEvent?.({
          event: { name: "on_interrupt", value: { q: 1 } },
        } as never);
        sub.onRunFinishedEvent?.({ event: {} } as never);
      },
    ]);

    await runAgentLoop({
      agent,
      renderer,
      tools,
      toolDescriptors,
      context,
      makeToolCtx: () => ({
        thread: {} as never,
        user: null,
        actor: { id: "actor", kind: "unknown" as const },
        platform: "fake",
      }),
      handleInterrupt,
    });

    expect(handleInterrupt).toHaveBeenCalledTimes(1);
    expect(handleInterrupt).toHaveBeenCalledWith({
      eventName: "on_interrupt",
      value: { q: 1 },
    });
    expect(agent.runAgentCalls).toBe(1);
    expect(agent.messages.some((m) => m.role === "tool")).toBe(false);
  });

  it("returns interrupted=true and an iteration count when the agent interrupts", async () => {
    const renderer = makeFakeRunRenderer();
    const tools = new Map<string, ChannelTool>();
    const handleInterrupt = vi.fn<(i: CapturedInterrupt) => void>();

    const agent = new FakeAgent([
      (sub: AgentSubscriber) => {
        sub.onCustomEvent?.({
          event: { name: "on_interrupt", value: { q: 1 } },
        } as never);
        sub.onRunFinishedEvent?.({ event: {} } as never);
      },
    ]);

    const args = {
      agent,
      renderer,
      tools,
      toolDescriptors,
      context,
      makeToolCtx: () => ({
        thread: {} as never,
        user: null,
        actor: { id: "actor", kind: "unknown" as const },
        platform: "fake",
      }),
      handleInterrupt,
    };

    const result = await runAgentLoop(args);
    expect(result.interrupted).toBe(true);
    expect(result.iterations).toBeGreaterThanOrEqual(1);
  });

  it("returns interrupted=false on a normal completion", async () => {
    const renderer = makeFakeRunRenderer();
    const tools = new Map<string, ChannelTool>();

    const agent = new FakeAgent([
      (sub: AgentSubscriber) => {
        sub.onRunFinishedEvent?.({ event: {} } as never);
      },
    ]);

    const args = {
      agent,
      renderer,
      tools,
      toolDescriptors,
      context,
      makeToolCtx: () => ({
        thread: {} as never,
        user: null,
        actor: { id: "actor", kind: "unknown" as const },
        platform: "fake",
      }),
    };

    const result = await runAgentLoop(args);
    expect(result.interrupted).toBe(false);
    expect(result.iterations).toBeGreaterThanOrEqual(1);
  });
  describe("forwarded identity", () => {
    const finishOnce = () => [
      (sub: AgentSubscriber) => {
        sub.onRunFinishedEvent?.({ event: {} } as never);
      },
    ];

    const baseArgs = (agent: FakeAgent) => ({
      agent,
      renderer: makeFakeRunRenderer(),
      tools: new Map<string, ChannelTool>(),
      toolDescriptors,
      context,
      makeToolCtx: () => ({
        thread: {} as never,
        user: null,
        actor: { id: "actor", kind: "unknown" as const },
        platform: "fake",
      }),
    });

    const identity = {
      id: "29:1a2b3c",
      kind: "human" as const,
      platform: "teams",
      name: "Ada",
    };

    it("forwards the actor to the agent on a normal run", async () => {
      const agent = new FakeAgent(finishOnce());

      await runAgentLoop({ ...baseArgs(agent), identity });

      expect(agent.runAgentParameters[0]?.forwardedProps).toEqual({
        channelActor: identity,
      });
    });

    it("keeps a provider id verbatim, including characters a model provider would reject", async () => {
      const agent = new FakeAgent(finishOnce());

      await runAgentLoop({ ...baseArgs(agent), identity });

      const forwarded = agent.runAgentParameters[0]?.forwardedProps as {
        channelActor: { id: string };
      };
      expect(forwarded.channelActor.id).toBe("29:1a2b3c");
    });

    it("forwards the actor alongside the resume command", async () => {
      const agent = new FakeAgent(finishOnce());

      await runAgentLoop({
        ...baseArgs(agent),
        identity,
        initialResume: { resume: { decision: "approve" } },
      });

      expect(agent.runAgentParameters[0]?.forwardedProps).toEqual({
        channelActor: identity,
        command: { resume: { decision: "approve" } },
      });
    });

    it("carries no actor key at all when the turn named nobody", async () => {
      const agent = new FakeAgent(finishOnce());

      await runAgentLoop(baseArgs(agent));

      expect(agent.runAgentParameters[0]?.forwardedProps).toEqual({});
    });
  });
});
