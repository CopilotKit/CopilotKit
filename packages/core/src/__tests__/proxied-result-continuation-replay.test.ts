import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EventType, type RunAgentParameters } from "@ag-ui/client";
import { MockSocket } from "./test-utils";
const { sockets } = vi.hoisted(() => ({ sockets: [] as MockSocket[] }));
vi.mock("phoenix", () => ({
  Socket: class extends MockSocket {
    constructor(...args: ConstructorParameters<typeof MockSocket>) {
      super(...args);
      sockets.push(this);
    }
  },
}));
const { ProxiedCopilotRuntimeAgent } = await import("../agent");
class ReplayProxy extends ProxiedCopilotRuntimeAgent {
  prepareResult(parameters: RunAgentParameters) {
    return this.prepareRunAgentInput(parameters);
  }
}
beforeEach(() => {
  sockets.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        threadId: "saved",
        runId: null,
        joinToken: "test",
        realtime: { clientUrl: "ws://localhost/client", topic: "thread:saved" },
      }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());
it("anchors result-only continuation to the actual delegated Intelligence replay", async () => {
  const agent = new ReplayProxy({
    runtimeUrl: "http://localhost/runtime",
    runtimeMode: "intelligence",
    intelligence: { wsUrl: "ws://localhost/client" },
    transport: "rest",
    agentId: "chat",
    threadId: "saved",
    capabilities: { custom: { "copilotkit.toolResultContinuation": true } },
  });
  const connecting = agent.connectAgent();
  await vi.waitFor(() => expect(sockets[0]?.channels[0]?.joinCount).toBe(1));
  const channel = sockets[0]!.channels[0]!;
  channel.triggerJoin("ok");
  for (const event of [
    { type: EventType.RUN_STARTED, threadId: "saved", runId: "original" },
    {
      type: EventType.TOOL_CALL_START,
      toolCallId: "frontend",
      toolCallName: "chart",
      parentMessageId: "calls",
    },
    { type: EventType.TOOL_CALL_ARGS, toolCallId: "frontend", delta: "{}" },
    { type: EventType.TOOL_CALL_END, toolCallId: "frontend" },
    {
      type: EventType.RUN_FINISHED,
      threadId: "saved",
      runId: "original",
      outcome: {
        type: "interrupt",
        interrupts: [{ id: "native", reason: "confirmation" }],
      },
    },
  ])
    channel.serverPush("ag_ui_event", event);
  channel.serverPush("replay_complete", {});
  channel.serverPush("stream_idle", {});
  await connecting;
  const result = {
    id: "result",
    role: "tool" as const,
    toolCallId: "frontend",
    content: "actual frontend result",
  };
  agent.addMessage(result);
  const prepared = agent.prepareResult({
    tools: [{ name: "chart", description: "chart", parameters: {} }],
    toolResultContinuation: [result],
  });
  expect(prepared.messages).toEqual([result]);
  expect(agent.pendingInterrupts).toEqual([
    { id: "native", reason: "confirmation" },
  ]);
});
