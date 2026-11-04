import { describe, expect, it } from "vitest";
import type { Message, RunAgentInput } from "@ag-ui/client";
import { scriptDealRun } from "../lib/scripted-deal-agent";

function createInput(messages: Message[]): RunAgentInput {
  return {
    threadId: "thread-1",
    runId: "run-1",
    messages,
    tools: [],
    context: [
      { description: "Notes", value: "plain text" },
      {
        description: "Current deal",
        value: JSON.stringify({ dealId: "deal-7", amount: 500 }),
      },
    ],
    state: {},
    forwardedProps: {},
  };
}

/** Collapses the run into its event types (one entry per text message) and the streamed text. */
function summarize(events: ReturnType<typeof scriptDealRun>) {
  const types: string[] = [];
  let text = "";
  for (const event of events) {
    if ("delta" in event && event.type === "TEXT_MESSAGE_CHUNK") {
      text += event.delta;
      if (types.at(-1) !== "TEXT") types.push("TEXT");
      continue;
    }
    types.push(
      "toolCallName" in event ? `TOOL:${event.toolCallName}` : event.type,
    );
  }
  return { types, text };
}

describe("scriptDealRun", () => {
  it("replies and asks for approval on a user message", () => {
    const events = scriptDealRun(
      createInput([{ id: "u1", role: "user", content: "Approve it" }]),
    );

    expect(summarize(events)).toEqual({
      types: ["RUN_STARTED", "TEXT", "TOOL:approveDeal", "RUN_FINISHED"],
      text: "Deal deal-7 is ready at $500. Please approve or reject it below.",
    });
    expect(events.find((event) => "toolCallName" in event)).toMatchObject({
      toolCallId: "run-1-approve",
      delta: '{"dealId":"deal-7","amount":500}',
    });
  });

  it("confirms after the approveDeal result", () => {
    const events = scriptDealRun(
      createInput([
        { id: "u1", role: "user", content: "Approve it" },
        {
          id: "t1",
          role: "tool",
          toolCallId: "run-0-approve",
          content: "approved",
        },
      ]),
    );

    expect(summarize(events)).toEqual({
      types: ["RUN_STARTED", "TEXT", "RUN_FINISHED"],
      text: "Done. The approval for deal-7 was recorded: approved",
    });
  });
});
