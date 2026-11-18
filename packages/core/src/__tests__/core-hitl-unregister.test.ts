import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@ag-ui/client";

import { CopilotKitCore } from "../core";
import {
  ɵHITL_ABORTED_MESSAGE,
  ɵbuildHumanInTheLoopTool,
} from "../core/human-in-the-loop";
import { MockAgent, createTool, createToolCallMessage } from "./test-utils";

/** Let the run reach the parked handler, and let microtasks settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function toolResults(agent: MockAgent): Message[] {
  return (agent.messages as Message[]).filter(
    (message) => message.role === "tool",
  );
}

describe("CopilotKitCore - human-in-the-loop tool unregistered mid-wait", () => {
  let core: CopilotKitCore;
  let agent: MockAgent;

  beforeEach(() => {
    core = new CopilotKitCore({});
    agent = new MockAgent({ agentId: "test" });
    core.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    core.dispose();
    vi.restoreAllMocks();
  });

  /** Register a HITL tool and start a run that calls it. */
  async function startParkedRun(name = "approve", calledName = name) {
    const tool = ɵbuildHumanInTheLoopTool({ name }, core.ɵhumanInTheLoop);
    const handler = vi.spyOn(tool, "handler");
    const unregister = core.addTool(tool);
    const message = createToolCallMessage(calledName);
    const toolCallId = (message as any).toolCalls[0].id as string;
    agent.setNewMessages([message]);

    const run = core.runAgent({ agent: agent as any });
    await flush();
    expect(core.ɵhumanInTheLoop.isPending(toolCallId)).toBe(true);
    const wait = handler.mock.results[0]!.value as Promise<unknown>;
    // Observe the rejection now so it is never reported as unhandled.
    const outcome = wait.then(
      (value) => ({ value }),
      (error: Error) => ({ error }),
    );
    return { run, unregister, toolCallId, outcome };
  }

  it("rejects the wait with the abort error and lets the run settle", async () => {
    const { run, unregister, toolCallId, outcome } = await startParkedRun();

    unregister();

    await expect(run).resolves.toBeDefined();
    expect(await outcome).toEqual({
      error: new Error(ɵHITL_ABORTED_MESSAGE),
    });
    expect(core.ɵhumanInTheLoop.isPending(toolCallId)).toBe(false);
    expect(toolResults(agent)).toEqual([
      expect.objectContaining({
        toolCallId,
        error: ɵHITL_ABORTED_MESSAGE,
      }),
    ]);
    // An aborted interaction never starts a follow-up run.
    expect(agent.runAgentCalls).toHaveLength(1);
  });

  it("rejects the wait when the tool is removed by name", async () => {
    const { run, outcome } = await startParkedRun();

    core.removeTool("approve");

    await run;
    expect(await outcome).toEqual({
      error: new Error(ɵHITL_ABORTED_MESSAGE),
    });
  });

  it("rejects the wait of a catch-all tool when it is unregistered", async () => {
    const { run, unregister, outcome } = await startParkedRun(
      "*",
      "deleteFile",
    );

    unregister();

    await run;
    expect(await outcome).toEqual({
      error: new Error(ɵHITL_ABORTED_MESSAGE),
    });
  });

  it("keeps the wait when the tool is registered again in the same pass", async () => {
    const { run, unregister, toolCallId, outcome } = await startParkedRun();

    // A dependency change or keyed remount tears down and re-registers at once.
    unregister();
    core.addTool(
      ɵbuildHumanInTheLoopTool({ name: "approve" }, core.ɵhumanInTheLoop),
    );
    await flush();

    expect(core.ɵhumanInTheLoop.isPending(toolCallId)).toBe(true);
    core.ɵhumanInTheLoop.respond(toolCallId, "approved");
    expect(await outcome).toEqual({ value: "approved" });
    await run;
  });

  it("does not bring back or reject again a wait after the tool returns", async () => {
    const { run, unregister, toolCallId, outcome } = await startParkedRun();
    unregister();
    await run;
    expect(await outcome).toEqual({
      error: new Error(ɵHITL_ABORTED_MESSAGE),
    });

    core.addTool(
      ɵbuildHumanInTheLoopTool({ name: "approve" }, core.ɵhumanInTheLoop),
    );
    await flush();

    expect(core.ɵhumanInTheLoop.isPending(toolCallId)).toBe(false);
    expect(core.ɵhumanInTheLoop.respond(toolCallId, "late")).toBe(false);
    expect(toolResults(agent)).toHaveLength(1);
  });

  it("does not abort an ordinary frontend tool that is unregistered while it runs", async () => {
    let finish: ((value: string) => void) | undefined;
    let receivedSignal: AbortSignal | undefined;
    const tool = createTool({
      name: "slow",
      followUp: false,
      handler: vi.fn(
        (_args: unknown, context: { signal?: AbortSignal }) =>
          new Promise<string>((resolve) => {
            receivedSignal = context.signal;
            finish = resolve;
          }),
      ),
    });
    const unregister = core.addTool(tool);
    agent.setNewMessages([createToolCallMessage("slow")]);
    const run = core.runAgent({ agent: agent as any });
    await flush();

    unregister();
    await flush();
    expect(receivedSignal?.aborted).toBe(false);

    finish?.("done");
    await run;
    expect(toolResults(agent)).toEqual([
      expect.objectContaining({ content: "done" }),
    ]);
  });
});
