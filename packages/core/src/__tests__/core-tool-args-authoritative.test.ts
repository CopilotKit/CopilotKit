import { describe, it, expect, beforeEach, vi } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { ReplaySubject } from "rxjs";
import { CopilotKitCore } from "../core";
import { createTool } from "./test-utils";

// ---------------------------------------------------------------------------
// Reproduction of #4935: a backend args_streamer enriches tool call arguments
// via TOOL_CALL_ARGS (authoritative per the AG-UI protocol), but a later
// MESSAGES_SNAPSHOT — still carrying the LLM's raw, hallucinated values —
// replaces agent.messages wholesale in @ag-ui/client. Both the render path
// (toolCall.function.arguments on the message) and the handler path
// (parseToolArguments in the run handler) must consume the authoritative args.
// ---------------------------------------------------------------------------

const HALLUCINATED_ARGS = JSON.stringify({
  postcode: "M1 1AA",
  addresses: [{ id: "1", line1: "1 Piccadilly Gardens" }],
});
const AUTHORITATIVE_ARGS = JSON.stringify({
  postcode: "M1 1AA",
  addresses: [
    { id: "6", line1: "1 Piccadilly" },
    { id: "7", line1: "15 Portland Street" },
  ],
});

class SequenceAgent extends AbstractAgent {
  public events = new ReplaySubject<BaseEvent>();

  run(_input: RunAgentInput) {
    return this.events.asObservable();
  }
}

function emitIssue4935Sequence(agent: SequenceAgent, toolCallId: string) {
  agent.events.next({
    type: EventType.RUN_STARTED,
    threadId: "t-1",
    runId: "r-1",
  });
  agent.events.next({
    type: EventType.TOOL_CALL_START,
    toolCallId,
    toolCallName: "select_address",
    parentMessageId: "asst-1",
  });
  // The args_streamer's replacement — a complete JSON payload, so the
  // accumulated buffer at TOOL_CALL_END matches the issue's evidence.
  agent.events.next({
    type: EventType.TOOL_CALL_ARGS,
    toolCallId,
    delta: AUTHORITATIVE_ARGS,
  });
  agent.events.next({ type: EventType.TOOL_CALL_END, toolCallId });
  // Snapshot built from the LLM's raw output (before enrichment) replaces
  // the tool-call message by id — the regression under test.
  agent.events.next({
    type: EventType.MESSAGES_SNAPSHOT,
    messages: [
      {
        id: "asst-1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: toolCallId,
            type: "function",
            function: {
              name: "select_address",
              arguments: HALLUCINATED_ARGS,
            },
          },
        ],
      },
    ],
  });
  agent.events.next({
    type: EventType.RUN_FINISHED,
    threadId: "t-1",
    runId: "r-1",
  });
  agent.events.complete();
}

describe("CopilotKitCore authoritative tool call args (#4935)", () => {
  let copilotKitCore: CopilotKitCore;

  beforeEach(() => {
    copilotKitCore = new CopilotKitCore({});
  });

  it("re-corrects args regressed by MESSAGES_SNAPSHOT and hands the authoritative args to the handler", async () => {
    const handler = vi.fn(async () => "done");
    const tool = createTool({
      name: "select_address",
      handler,
      followUp: false,
    });
    copilotKitCore.addTool(tool);

    const agent = new SequenceAgent({ agentId: "seq-agent", threadId: "t-1" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "seq-agent",
      agent: agent as any,
    });
    // addAgent__unsafe_dev_only notifies subscribers asynchronously; let the
    // core-level agent subscriptions (incl. the tool-args manager) settle
    // before driving the event stream.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const runPromise = copilotKitCore.runAgent({ agent: agent as any });
    emitIssue4935Sequence(agent, "call-1");
    await runPromise;

    const toolCallMessage = agent.messages.find(
      (m) => m.role === "assistant" && m.toolCalls?.length,
    );
    expect(toolCallMessage?.role).toBe("assistant");
    if (toolCallMessage?.role !== "assistant") {
      throw new Error("Expected an assistant message with a tool call");
    }
    expect(toolCallMessage.toolCalls?.[0]?.function.arguments).toBe(
      AUTHORITATIVE_ARGS,
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      JSON.parse(AUTHORITATIVE_ARGS),
      expect.objectContaining({
        toolCall: expect.objectContaining({ id: "call-1" }),
      }),
    );
  });

  it("hands authoritative args to wildcard tools through the same fallback", async () => {
    const captured: Array<Record<string, unknown>> = [];
    const wildcard = createTool({
      name: "*",
      handler: async (args: any) => {
        captured.push(args);
        return "done";
      },
      followUp: false,
    });
    copilotKitCore.addTool(wildcard);

    const agent = new SequenceAgent({ agentId: "seq-agent", threadId: "t-1" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "seq-agent",
      agent: agent as any,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const runPromise = copilotKitCore.runAgent({ agent: agent as any });
    emitIssue4935Sequence(agent, "call-1");
    await runPromise;

    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({
      toolName: "select_address",
      args: JSON.parse(AUTHORITATIVE_ARGS),
    });
  });

  it("leaves messages untouched when the snapshot matches the accumulated args", async () => {
    const handler = vi.fn(async () => "done");
    const tool = createTool({
      name: "select_address",
      handler,
      followUp: false,
    });
    copilotKitCore.addTool(tool);

    const agent = new SequenceAgent({ agentId: "seq-agent", threadId: "t-1" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "seq-agent",
      agent: agent as any,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const runPromise = copilotKitCore.runAgent({ agent: agent as any });
    // Ordinary flow without an args_streamer: the snapshot carries the same
    // accumulated args, so no correction should occur.
    agent.events.next({
      type: EventType.RUN_STARTED,
      threadId: "t-1",
      runId: "r-1",
    });
    agent.events.next({
      type: EventType.TOOL_CALL_START,
      toolCallId: "call-1",
      toolCallName: "select_address",
      parentMessageId: "asst-1",
    });
    agent.events.next({
      type: EventType.TOOL_CALL_ARGS,
      toolCallId: "call-1",
      delta: AUTHORITATIVE_ARGS,
    });
    agent.events.next({ type: EventType.TOOL_CALL_END, toolCallId: "call-1" });
    agent.events.next({
      type: EventType.MESSAGES_SNAPSHOT,
      messages: [
        {
          id: "asst-1",
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "select_address",
                arguments: AUTHORITATIVE_ARGS,
              },
            },
          ],
        },
      ],
    });
    agent.events.next({
      type: EventType.RUN_FINISHED,
      threadId: "t-1",
      runId: "r-1",
    });
    agent.events.complete();
    await runPromise;

    expect(handler).toHaveBeenCalledWith(
      JSON.parse(AUTHORITATIVE_ARGS),
      expect.anything(),
    );
    const toolCallMessage = agent.messages.find(
      (m) => m.role === "assistant" && m.toolCalls?.length,
    );
    expect(toolCallMessage?.role).toBe("assistant");
    if (toolCallMessage?.role !== "assistant") {
      throw new Error("Expected an assistant message with a tool call");
    }
    expect(toolCallMessage.toolCalls?.[0]?.function.arguments).toBe(
      AUTHORITATIVE_ARGS,
    );
  });
});
