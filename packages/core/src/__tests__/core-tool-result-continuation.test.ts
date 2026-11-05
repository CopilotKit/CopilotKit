import {
  AbstractAgent,
  EventType,
  type BaseEvent,
  type RunAgentInput,
} from "@ag-ui/client";
import { of, type Observable } from "rxjs";
import { describe, expect, it } from "vitest";
import { CopilotKitCore } from "../core";
import { createTool } from "./test-utils";
import { ProxiedCopilotRuntimeAgent } from "../agent";

class MixedAgent extends AbstractAgent {
  readonly inputs: RunAgentInput[] = [];
  public run(input: RunAgentInput): Observable<BaseEvent> {
    this.inputs.push(input);
    const events: BaseEvent[] = [
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
    ];
    if (this.inputs.length === 1) {
      events.push(
        {
          type: EventType.TOOL_CALL_START,
          toolCallId: "chart-call",
          toolCallName: "chart",
          parentMessageId: "calls",
        },
        {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId: "chart-call",
          delta: "{}",
        },
        { type: EventType.TOOL_CALL_END, toolCallId: "chart-call" },
      );
    }
    events.push({
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId: input.runId,
      outcome: {
        type: "interrupt",
        interrupts: [{ id: "native-approval", reason: "confirmation" }],
      },
    });
    return of(...events);
  }
}

describe("trusted frontend result continuation", () => {
  it("retains the default pending-interrupt guard without opt-in", async () => {
    const core = new CopilotKitCore({});
    const agent = new MixedAgent({ agentId: "test", threadId: "thread" });
    core.addAgent__unsafe_dev_only({ id: "test", agent });
    core.addTool(
      createTool({
        name: "chart",
        handler: async () => "real result",
        followUp: true,
      }),
    );
    await core.runAgent({ agent });
    await expect(agent.runAgent()).rejects.toThrow(/resume/i);
    expect(agent.inputs).toHaveLength(1);
    expect(agent.pendingInterrupts).toHaveLength(1);
  });

  it("sends only the actual fresh frontend result while retaining the native interrupt", async () => {
    const core = new CopilotKitCore({});
    const agent = new MixedAgent({
      agentId: "test",
      threadId: "thread",
      allowToolResultContinuation: true,
    });
    core.addAgent__unsafe_dev_only({ id: "test", agent });
    core.addTool(
      createTool({
        name: "chart",
        handler: async () => "  exact chart result  ",
        followUp: true,
      }),
    );
    await core.runAgent({ agent });
    expect(agent.inputs).toHaveLength(2);
    expect(agent.inputs[1]?.messages).toEqual([
      expect.objectContaining({
        role: "tool",
        toolCallId: "chart-call",
        content: "  exact chart result  ",
      }),
    ]);
    expect(agent.inputs[1]?.resume).toBeUndefined();
    expect(agent.pendingInterrupts).toEqual([
      { id: "native-approval", reason: "confirmation" },
    ]);
  });

  it("does not enable the capability on ordinary proxies", () => {
    const ordinary = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://example.com",
      agentId: "test",
    });
    const enabled = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://example.com",
      agentId: "test",
      capabilities: { custom: { "copilotkit.toolResultContinuation": true } },
    });
    expect(ordinary.allowToolResultContinuation).toBe(false);
    expect(enabled.allowToolResultContinuation).toBe(true);
    expect(enabled.clone().allowToolResultContinuation).toBe(true);
    enabled.allowToolResultContinuation = false;
    expect(enabled.clone().allowToolResultContinuation).toBe(false);
  });

  it("preserves the verified result checkpoint when a proxy is cloned", async () => {
    const received: RunAgentInput[] = [];
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://example.com",
      agentId: "test",
      transport: "rest",
      runtimeMode: "sse",
      capabilities: { custom: { "copilotkit.toolResultContinuation": true } },
      fetch: async (_url, init) => {
        if (typeof init?.body !== "string")
          throw new Error("Expected JSON request");
        const input: RunAgentInput = JSON.parse(init.body);
        received.push(input);
        const events: BaseEvent[] = [
          {
            type: EventType.RUN_STARTED,
            threadId: input.threadId,
            runId: input.runId,
          },
        ];
        if (received.length === 1)
          events.push(
            {
              type: EventType.TOOL_CALL_START,
              toolCallId: "chart",
              toolCallName: "chart",
              parentMessageId: "calls",
            },
            {
              type: EventType.TOOL_CALL_ARGS,
              toolCallId: "chart",
              delta: "{}",
            },
            { type: EventType.TOOL_CALL_END, toolCallId: "chart" },
          );
        events.push({
          type: EventType.RUN_FINISHED,
          threadId: input.threadId,
          runId: input.runId,
          outcome: {
            type: "interrupt",
            interrupts: [{ id: "native", reason: "confirmation" }],
          },
        });
        return new Response(
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });
    const tools = [
      { name: "chart", description: "chart", parameters: { type: "object" } },
    ];
    await agent.runAgent({ tools });
    const clone = agent.clone();
    const result = {
      id: "actual-result",
      role: "tool" as const,
      toolCallId: "chart",
      content: "actual",
    };
    clone.addMessage(result);
    await clone.runAgent({ tools, toolResultContinuation: [result] });
    expect(received[1]?.messages).toEqual([result]);
    expect(clone.pendingInterrupts).toEqual([
      { id: "native", reason: "confirmation" },
    ]);
  });
});
