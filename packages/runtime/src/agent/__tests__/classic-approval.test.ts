/**
 * A classic config tool declared `needsApproval: true` pauses the run with a
 * `tool_approval` interrupt. The resume run hands the decision to `chat()`,
 * which runs the tool on approve and skips it on reject.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { EventType } from "@ag-ui/client";
import type { ResumeEntry } from "@ag-ui/client";
import { toolDefinition } from "@tanstack/ai";
import {
  collectEvents,
  collectEventsIncludingErrors,
  createDefaultInput,
  createFakeModel,
  eventsOfType,
} from "./agent-test-helpers";
import { BuiltInAgent } from "../index";

function refundTool() {
  const calls: unknown[] = [];
  const tool = toolDefinition({
    name: "refund",
    description: "Refund an order",
    inputSchema: z.object({ orderId: z.string() }),
    needsApproval: true,
  }).server(async (args) => {
    calls.push(args);
    return { refunded: true };
  });
  return { tool, calls };
}

/** The history the client sends back after the paused run. */
const pausedHistory = [
  { id: "user-1", role: "user" as const, content: "Refund order 42" },
  {
    id: "assistant-1",
    role: "assistant" as const,
    content: "",
    toolCalls: [
      {
        id: "tc-1",
        type: "function" as const,
        function: { name: "refund", arguments: '{"orderId":"42"}' },
      },
    ],
  },
];

async function resumeWith(entry: ResumeEntry) {
  const refund = refundTool();
  const { model, requests } = createFakeModel([{ text: "Done." }]);
  const agent = new BuiltInAgent({
    model,
    tools: [refund.tool],
    maxSteps: 3,
  });
  const events = await collectEvents(
    agent.run(
      createDefaultInput({
        runId: "run-2",
        messages: pausedHistory,
        resume: [entry],
      }),
    ),
  );
  return { events, calls: refund.calls, requests };
}

describe("Classic needsApproval tools", () => {
  it("pause the run with a tool_approval interrupt keyed by the tool call", async () => {
    const refund = refundTool();
    const { model } = createFakeModel([
      { toolCalls: [{ id: "tc-1", name: "refund", input: { orderId: "42" } }] },
    ]);
    const agent = new BuiltInAgent({ model, tools: [refund.tool] });
    const events = await collectEvents(agent.run(createDefaultInput()));

    expect(refund.calls).toEqual([]);
    const [finished] = eventsOfType(events, EventType.RUN_FINISHED);
    expect(finished?.outcome).toMatchObject({
      type: "interrupt",
      interrupts: [{ id: "tc-1", toolCallId: "tc-1", reason: "tool_approval" }],
    });
  });

  it("run the tool when the resume approves it", async () => {
    const { events, calls, requests } = await resumeWith({
      interruptId: "tc-1",
      status: "resolved",
      payload: { approved: true },
    });

    expect(calls).toEqual([{ orderId: "42" }]);
    expect(eventsOfType(events, EventType.TOOL_CALL_RESULT)).toEqual([
      expect.objectContaining({
        toolCallId: "tc-1",
        content: JSON.stringify({ refunded: true }),
      }),
    ]);
    // The model sees the tool's real result, not the approval payload.
    const toolMessage = requests[0]?.messages.find(
      (message) => message.role === "tool",
    );
    expect(toolMessage?.content).toBe(JSON.stringify({ refunded: true }));
    const [finished] = eventsOfType(events, EventType.RUN_FINISHED);
    expect(finished?.outcome).toBeUndefined();
  });

  it("skip the tool when the resume rejects it", async () => {
    const { calls, requests } = await resumeWith({
      interruptId: "tc-1",
      status: "resolved",
      payload: { approved: false },
    });

    expect(calls).toEqual([]);
    const toolMessage = requests[0]?.messages.find(
      (message) => message.role === "tool",
    );
    expect(toolMessage?.content).not.toBe(JSON.stringify({ refunded: true }));
  });

  it("skip the tool when a rejection carries a message", async () => {
    const { events, calls } = await resumeWith({
      interruptId: "tc-1",
      status: "resolved",
      payload: { approved: false, message: "Not this order" },
    });

    expect(calls).toEqual([]);
    expect(eventsOfType(events, EventType.RUN_ERROR)).toEqual([]);
  });

  it("run the tool when the client already added the decision as a tool message", async () => {
    const refund = refundTool();
    const { model } = createFakeModel([{ text: "Done." }]);
    const agent = new BuiltInAgent({ model, tools: [refund.tool] });
    await collectEvents(
      agent.run(
        createDefaultInput({
          messages: [
            ...pausedHistory,
            {
              id: "tool-1",
              role: "tool",
              toolCallId: "tc-1",
              content: JSON.stringify({ approved: true }),
            },
          ],
          resume: [
            {
              interruptId: "tc-1",
              status: "resolved",
              payload: { approved: true },
            },
          ],
        }),
      ),
    );

    expect(refund.calls).toEqual([{ orderId: "42" }]);
  });

  it("keep the result of an approval answered in an earlier turn", async () => {
    const refund = refundTool();
    const { model, requests } = createFakeModel([{ text: "Done." }]);
    const agent = new BuiltInAgent({ model, tools: [refund.tool] });
    const earlierResult = JSON.stringify({ refunded: true });
    await collectEvents(
      agent.run(
        createDefaultInput({
          messages: [
            ...pausedHistory,
            {
              id: "tool-1",
              role: "tool",
              toolCallId: "tc-1",
              content: earlierResult,
            },
            { id: "user-2", role: "user", content: "Thanks" },
          ],
        }),
      ),
    );

    expect(refund.calls).toEqual([]);
    const toolMessage = requests[0]?.messages.find(
      (message) => message.role === "tool",
    );
    expect(toolMessage?.content).toBe(earlierResult);
  });

  it("report an approval payload without an approved decision as a run error", async () => {
    const refund = refundTool();
    const { model } = createFakeModel([{ text: "Done." }]);
    const agent = new BuiltInAgent({ model, tools: [refund.tool] });
    const { events, errored } = await collectEventsIncludingErrors(
      agent.run(
        createDefaultInput({
          messages: pausedHistory,
          resume: [
            { interruptId: "tc-1", status: "resolved", payload: { ok: true } },
          ],
        }),
      ),
    );

    expect(errored).toBe(true);
    expect(refund.calls).toEqual([]);
    const [error] = eventsOfType(events, EventType.RUN_ERROR);
    expect(error?.message).toContain("must be a boolean or decision envelope");
  });

  it("skip the tool when the resume is cancelled", async () => {
    const { calls } = await resumeWith({
      interruptId: "tc-1",
      status: "cancelled",
    });

    expect(calls).toEqual([]);
  });
});
