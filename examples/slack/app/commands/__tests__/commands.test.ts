import { describe, it, expect, vi } from "vitest";
import { appCommands } from "../index.js";
import type { CommandContext } from "@copilotkit/bot";

const byName = (name: string) => {
  const cmd = appCommands.find((c) => c.name === name);
  if (!cmd) throw new Error(`command ${name} not registered`);
  return cmd;
};

/** A minimal fake thread capturing runAgent input and posted text. */
function fakeThread() {
  return {
    runAgent: vi.fn(
      async (_input?: { prompt?: string; context?: unknown }) => undefined,
    ),
    post: vi.fn(async (_ui?: unknown) => ({ id: "m1" })),
  };
}

const ctx = (over: Partial<CommandContext>): CommandContext =>
  ({
    thread: fakeThread() as never,
    command: "x",
    text: "",
    options: {},
    platform: "slack",
    ...over,
  }) as CommandContext;

describe("example slash commands", () => {
  it("registers /agent and /triage", () => {
    expect(appCommands.map((c) => c.name).sort()).toEqual(["agent", "triage"]);
  });

  it("/agent runs the agent with the command text as the prompt", async () => {
    const thread = fakeThread();
    await byName("agent").handler(
      ctx({
        command: "agent",
        text: "why is prod down",
        thread: thread as never,
      }),
    );
    expect(thread.runAgent).toHaveBeenCalledTimes(1);
    expect(thread.runAgent.mock.calls[0]![0]).toMatchObject({
      prompt: "why is prod down",
    });
  });

  it("/agent with no text posts usage and does not run the agent", async () => {
    const thread = fakeThread();
    await byName("agent").handler(
      ctx({ command: "agent", text: "", thread: thread as never }),
    );
    expect(thread.runAgent).not.toHaveBeenCalled();
    expect(thread.post).toHaveBeenCalledTimes(1);
  });

  it("/triage runs the agent with a triage prompt", async () => {
    const thread = fakeThread();
    await byName("triage").handler(
      ctx({ command: "triage", text: "", thread: thread as never }),
    );
    expect(thread.runAgent).toHaveBeenCalledTimes(1);
    expect(String(thread.runAgent.mock.calls[0]![0]?.prompt)).toMatch(
      /triage/i,
    );
  });
});
