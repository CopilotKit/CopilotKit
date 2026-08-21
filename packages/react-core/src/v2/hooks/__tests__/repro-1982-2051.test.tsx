/**
 * Reproduction harness for CopilotKit issues #1982 and #2051.
 *
 * Both issues describe a *backend*-executed tool (LangGraph tool node) rendered
 * on the frontend by a render-only / catch-all action:
 *
 *   #1982 — status goes inProgress -> executing and never reaches "complete".
 *   #2051 — `result` stays empty until the whole graph finishes, instead of
 *           landing as each tool node completes.
 *
 * The AG-UI LangGraph adapter emits TOOL_CALL_RESULT at `OnToolEnd`, i.e. mid-run.
 * So the crux of both reports is: when TOOL_CALL_RESULT arrives BEFORE
 * RUN_FINISHED, does the render observe status="complete" with the result?
 */
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { z } from "zod";
import { ToolCallStatus } from "@copilotkit/core";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
  runStartedEvent,
  runFinishedEvent,
  textChunkEvent,
  toolCallChunkEvent,
  toolCallResultEvent,
  testId,
} from "../../__tests__/utils/test-helpers";

async function submitUserMessage(text: string) {
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await waitFor(() => {
    expect(screen.getByText(text)).toBeDefined();
  });
}

describe("repro #1982 / #2051 — backend tool result reaching a catch-all render", () => {
  it("reaches status=complete with the result BEFORE run finished", async () => {
    const observed: Array<{ status: string; result: unknown }> = [];

    // Equivalent of the reporters' `useCopilotAction({ name: "*", available: "disabled", render })`
    const WildcardRender: React.FC<any> = ({ name, status, result }) => {
      observed.push({ status, result });
      return (
        <div data-testid="wildcard">
          {name}:{status}:{String(result ?? "")}
        </div>
      );
    };

    const agent = new MockStepwiseAgent();
    renderWithCopilotKit({
      agent,
      renderToolCalls: [
        {
          name: "*",
          args: z.object({ toolName: z.string(), args: z.unknown() }),
          render: WildcardRender,
        },
      ] as any,
    });

    await submitUserMessage("What's the weather?");

    const messageId = testId("msg");
    const toolCallId = testId("tc");

    agent.emit(runStartedEvent());
    agent.emit(textChunkEvent(messageId, "Checking the weather."));
    agent.emit(
      toolCallChunkEvent({
        toolCallId,
        toolCallName: "get_weather",
        parentMessageId: messageId,
        delta: JSON.stringify({ city: "Berlin" }),
      }),
    );

    // Tool call is visible and NOT complete yet.
    await waitFor(() => expect(screen.getByTestId("wildcard")).toBeDefined());
    expect(observed.at(-1)!.status).not.toBe(ToolCallStatus.Complete);

    // OnToolEnd equivalent: backend tool finished, result streamed mid-run.
    agent.emit(
      toolCallResultEvent({
        toolCallId,
        messageId: testId("tm"),
        content: "sunny, 22C",
      }),
    );

    // THE CRUX: complete + result must be observable before RUN_FINISHED.
    await waitFor(() => {
      expect(screen.getByTestId("wildcard").textContent).toContain(
        "sunny, 22C",
      );
    });
    const atToolEnd = observed.at(-1)!;
    expect(atToolEnd.status).toBe(ToolCallStatus.Complete);
    expect(atToolEnd.result).toBe("sunny, 22C");

    agent.emit(runFinishedEvent());
    agent.complete();
  });

  it("renders ALL parallel tool calls on one assistant message, not just the first", async () => {
    // #2051's backend does asyncio.gather over every tool_call on the message,
    // so a single assistant message carries multiple parallel tool calls.
    const WildcardRender: React.FC<any> = ({ name, status, result }) => (
      <div data-testid={`wildcard-${name}`}>
        {name}:{status}:{String(result ?? "")}
      </div>
    );

    const agent = new MockStepwiseAgent();
    renderWithCopilotKit({
      agent,
      renderToolCalls: [
        {
          name: "*",
          args: z.object({ toolName: z.string(), args: z.unknown() }),
          render: WildcardRender,
        },
      ] as any,
    });

    await submitUserMessage("Run both tools");

    const messageId = testId("msg");
    const tc1 = testId("tc1");
    const tc2 = testId("tc2");

    agent.emit(runStartedEvent());
    agent.emit(textChunkEvent(messageId, "Running both."));
    agent.emit(
      toolCallChunkEvent({
        toolCallId: tc1,
        toolCallName: "tool_one",
        parentMessageId: messageId,
        delta: JSON.stringify({ x: 1 }),
      }),
    );
    agent.emit(
      toolCallChunkEvent({
        toolCallId: tc2,
        toolCallName: "tool_two",
        parentMessageId: messageId,
        delta: JSON.stringify({ x: 2 }),
      }),
    );
    agent.emit(
      toolCallResultEvent({
        toolCallId: tc1,
        messageId: testId("tm1"),
        content: "one-done",
      }),
    );
    agent.emit(
      toolCallResultEvent({
        toolCallId: tc2,
        messageId: testId("tm2"),
        content: "two-done",
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("wildcard-tool_one").textContent).toContain(
        "one-done",
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("wildcard-tool_two").textContent).toContain(
        "two-done",
      );
    });

    agent.emit(runFinishedEvent());
    agent.complete();
  });
});
