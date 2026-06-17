import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { runAgentLoop } from "./run-loop.js";
import { makeFakeRunRenderer } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";
import type { BotTool, AgentToolDescriptor, ContextEntry } from "./tools.js";
import type { AgentSubscriber } from "@ag-ui/client";
import type { CapturedInterrupt } from "./platform-adapter.js";

const toolDescriptors: AgentToolDescriptor[] = [];
const context: ContextEntry[] = [];

describe("runAgentLoop", () => {
  it("executes a frontend tool call and pushes the result, then terminates", async () => {
    const renderer = makeFakeRunRenderer();

    const recorded: Array<{ msg: string }> = [];
    const echo: BotTool = {
      name: "echo",
      description: "echo back",
      parameters: z.object({ msg: z.string() }),
      handler: (args) => {
        recorded.push(args as { msg: string });
        return { ok: true };
      },
    };
    const tools = new Map<string, BotTool>([["echo", echo]]);

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
      makeToolCtx: () => ({ thread: {} as never, platform: "fake" }),
    });

    expect(recorded).toEqual([{ msg: "hi" }]);
    expect(agent.runAgentCalls).toBe(2);
    const toolResult = agent.messages.find((m) => m.role === "tool");
    expect(toolResult).toBeDefined();
    expect((toolResult as { toolCallId?: string }).toolCallId).toBe("t1");
  });

  it("posts the picker via handleInterrupt and returns without running tools", async () => {
    const renderer = makeFakeRunRenderer();
    const tools = new Map<string, BotTool>();
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
      makeToolCtx: () => ({ thread: {} as never, platform: "fake" }),
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
});
