import { describe, it, expect } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunFinishedEvent } from "@ag-ui/client";
import {
  BuiltInAgent,
  createDefaultInput,
  collectEvents,
  toolCall,
  tanstackToolCallStart,
  tanstackToolCallEnd,
  tanstackApprovalRunFinished,
} from "./agent-test-helpers";

function lastRunFinished(events: BaseEvent[]) {
  const finished = events.filter(
    (event): event is RunFinishedEvent => event.type === EventType.RUN_FINISHED,
  );
  return finished.at(-1);
}

const aisdkApproval = (described: boolean) =>
  new BuiltInAgent({
    type: "aisdk",
    factory: (ctx) => {
      if (described) {
        ctx.describeInterruptTool("approvePayment", {
          reason: "payment_approval",
          message: "Approve this payment?",
        });
      }
      return {
        fullStream: (async function* () {
          yield toolCall("call-1", "approvePayment", { amount: 5 });
          yield {
            type: "tool-approval-request",
            toolCallId: "call-1",
            approvalId: "approval-call-1",
            toolCall: { toolCallId: "call-1", toolName: "approvePayment" },
          };
          yield { type: "finish", finishReason: "tool-calls" };
        })(),
      };
    },
  });

describe("ctx.describeInterruptTool", () => {
  it("puts the described reason and message on an AI SDK approval interrupt", async () => {
    const events = await collectEvents(
      aisdkApproval(true).run(createDefaultInput()),
    );

    expect(lastRunFinished(events)?.outcome).toMatchObject({
      type: "interrupt",
      interrupts: [
        {
          id: "call-1",
          reason: "payment_approval",
          message: "Approve this payment?",
          metadata: { toolName: "approvePayment" },
        },
      ],
    });
  });

  it("keeps the tool_approval reason for a tool that was not described", async () => {
    const events = await collectEvents(
      aisdkApproval(false).run(createDefaultInput()),
    );

    expect(lastRunFinished(events)?.outcome).toMatchObject({
      interrupts: [{ id: "call-1", reason: "tool_approval" }],
    });
  });

  it("defaults the reason to tool_call on a TanStack AI approval interrupt", async () => {
    const agent = new BuiltInAgent({
      type: "tanstack",
      factory: (ctx) => {
        ctx.describeInterruptTool("approvePayment", {});
        return (async function* () {
          yield tanstackToolCallStart("call-1", "approvePayment");
          yield tanstackToolCallEnd("call-1");
          yield tanstackApprovalRunFinished("call-1", "approvePayment");
        })();
      },
    });

    const events = await collectEvents(agent.run(createDefaultInput()));

    expect(lastRunFinished(events)?.outcome).toMatchObject({
      interrupts: [{ id: "call-1", reason: "tool_call" }],
    });
    expect(
      lastRunFinished(events)?.outcome?.["interrupts"]?.[0]?.message,
    ).toBeUndefined();
  });
});
