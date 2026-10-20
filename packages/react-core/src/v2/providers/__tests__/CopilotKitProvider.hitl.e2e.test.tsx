import React, { useEffect } from "react";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { z } from "zod";
import { ToolCallStatus } from "@copilotkit/core";
import type { ReactHumanInTheLoop } from "../../types";
import { CopilotChat } from "../../components/chat/CopilotChat";
import { useCopilotKit } from "../../context";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
  runStartedEvent,
  runFinishedEvent,
  toolCallChunkEvent,
  testId,
} from "../../__tests__/utils/test-helpers";

/**
 * The `humanInTheLoop` prop on the provider is a second registration path
 * beside the `useHumanInTheLoop` hook, and it has to honor the same contract:
 * the tool call waits for the user, `respond` is live only while the call is
 * executing, and an aborted run rejects rather than resolving empty.
 *
 * These tests mount the real pipeline (CopilotChat -> tool calls view -> the
 * provider's registered renderer) rather than invoking the renderer directly,
 * so a mismatch between the key the handler parks under and the tool call id
 * the pipeline supplies cannot pass.
 */
describe("CopilotKitProvider humanInTheLoop prop E2E", () => {
  const bookCall = (
    overrides: Partial<ReactHumanInTheLoop<any>> = {},
  ): ReactHumanInTheLoop<any> => ({
    name: "book_call",
    description: "Pick a time slot",
    parameters: z.object({ topic: z.string() }),
    render: ({ status, args, result, respond, name }) => (
      <div data-testid="hitl">
        <div data-testid="hitl-name">{name}</div>
        <div data-testid="hitl-status">{status}</div>
        <div data-testid="hitl-topic">{args?.topic ?? ""}</div>
        {result ? <div data-testid="hitl-result">{result}</div> : null}
        {respond ? (
          <button
            data-testid="hitl-respond"
            onClick={() => respond(JSON.stringify({ slot: "Tue 14:00" }))}
          >
            Pick
          </button>
        ) : null}
      </div>
    ),
    ...overrides,
  });

  async function driveToolCall(
    agent: MockStepwiseAgent,
    toolCallName: string,
    args: Record<string, unknown> = { topic: "waterfall project" },
  ) {
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "book a call" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("book a call")).toBeDefined();
    });

    agent.emit(runStartedEvent());
    agent.emit(
      toolCallChunkEvent({
        toolCallId: testId("tc"),
        toolCallName,
        parentMessageId: testId("msg"),
        delta: JSON.stringify(args),
      }),
    );
  }

  it("waits for the user and completes with the response", async () => {
    const agent = new MockStepwiseAgent();

    renderWithCopilotKit({
      agent,
      humanInTheLoop: [bookCall()],
      children: (
        <div style={{ height: 400 }}>
          <CopilotChat welcomeScreen={false} />
        </div>
      ),
    });

    await driveToolCall(agent, "book_call");

    await waitFor(() => {
      expect(screen.getByTestId("hitl-status").textContent).toBe(
        ToolCallStatus.InProgress,
      );
      expect(screen.getByTestId("hitl-topic").textContent).toBe(
        "waterfall project",
      );
    });

    // The stream ends here, which is where the reported bug showed itself: the
    // render must stay on screen and interactive, waiting on the user.
    agent.emit(runFinishedEvent());
    agent.complete();

    const respondButton = await screen.findByTestId("hitl-respond");
    expect(screen.getByTestId("hitl-status").textContent).toBe(
      ToolCallStatus.Executing,
    );

    fireEvent.click(respondButton);

    await waitFor(() => {
      expect(screen.getByTestId("hitl-status").textContent).toBe(
        ToolCallStatus.Complete,
      );
      expect(screen.getByTestId("hitl-result").textContent).toContain(
        "Tue 14:00",
      );
    });
  });

  it("passes the invoked tool name to a wildcard registration", async () => {
    const agent = new MockStepwiseAgent();

    renderWithCopilotKit({
      agent,
      humanInTheLoop: [bookCall({ name: "*" })],
      children: (
        <div style={{ height: 400 }}>
          <CopilotChat welcomeScreen={false} />
        </div>
      ),
    });

    await driveToolCall(agent, "deleteFile", { topic: "cleanup" });

    agent.emit(runFinishedEvent());
    agent.complete();

    await screen.findByTestId("hitl-respond");
    // A catch-all registration is named "*", which is not the name of anything
    // the agent called. The render has to see the tool it is approving.
    expect(screen.getByTestId("hitl-name").textContent).toBe("deleteFile");
  });

  it("hands off from one call of a tool to the next, resolving each on its own", async () => {
    const agent = new MockStepwiseAgent();
    const firstId = testId("tc-a");
    const secondId = testId("tc-b");

    renderWithCopilotKit({
      agent,
      humanInTheLoop: [
        {
          ...bookCall(),
          render: ({ status, args, result, respond }: any) => (
            <div data-testid={`hitl-${args?.topic ?? "none"}`}>
              <div data-testid={`status-${args?.topic}`}>{status}</div>
              {result ? (
                <div data-testid={`result-${args?.topic}`}>{result}</div>
              ) : null}
              {respond ? (
                <button
                  data-testid={`respond-${args?.topic}`}
                  onClick={() =>
                    respond(JSON.stringify({ picked: args.topic }))
                  }
                >
                  Pick
                </button>
              ) : null}
            </div>
          ),
        },
      ],
      children: (
        <div style={{ height: 400 }}>
          <CopilotChat welcomeScreen={false} />
        </div>
      ),
    });

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "book two calls" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    await waitFor(() => {
      expect(screen.getByText("book two calls")).toBeDefined();
    });

    const parentMessageId = testId("msg");
    agent.emit(runStartedEvent());
    agent.emit(
      toolCallChunkEvent({
        toolCallId: firstId,
        toolCallName: "book_call",
        parentMessageId,
        delta: JSON.stringify({ topic: "alpha" }),
      }),
    );
    agent.emit(
      toolCallChunkEvent({
        toolCallId: secondId,
        toolCallName: "book_call",
        parentMessageId,
        delta: JSON.stringify({ topic: "beta" }),
      }),
    );
    agent.emit(runFinishedEvent());
    agent.complete();

    // Core executes the tool calls of one message in order, so only the first
    // is waiting on the user at this point.
    const alphaButton = await screen.findByTestId("respond-alpha");
    expect(screen.queryByTestId("respond-beta")).toBeNull();
    expect(screen.getByTestId("status-beta").textContent).toBe(
      ToolCallStatus.InProgress,
    );

    fireEvent.click(alphaButton);

    // Answering the first call resolves that call and hands off to the second,
    // which then gets its own live respond. A resolver keyed by anything but
    // the tool call id would either resolve the wrong promise here or strand
    // the second call with no way to answer it.
    await waitFor(() => {
      expect(screen.getByTestId("status-alpha").textContent).toBe(
        ToolCallStatus.Complete,
      );
      expect(screen.getByTestId("result-alpha").textContent).toContain("alpha");
    });

    const betaButton = await screen.findByTestId("respond-beta");
    expect(screen.getByTestId("status-beta").textContent).toBe(
      ToolCallStatus.Executing,
    );

    fireEvent.click(betaButton);

    await waitFor(() => {
      expect(screen.getByTestId("status-beta").textContent).toBe(
        ToolCallStatus.Complete,
      );
      expect(screen.getByTestId("result-beta").textContent).toContain("beta");
    });
  });

  it("rejects the parked promise with an error tool result when the run is aborted", async () => {
    // Same contract as #5554 on the hook path: an abort while the user is being
    // waited on must record an explicit error, not an empty success.
    const agent = new MockStepwiseAgent();
    const toolExecutionEnds: Array<{ result: string; error?: string }> = [];

    const Subscriber: React.FC = () => {
      const { copilotkit } = useCopilotKit();
      useEffect(() => {
        const subscription = copilotkit.subscribe({
          onToolExecutionEnd: ({ result, error }) => {
            toolExecutionEnds.push({ result, error });
          },
        });
        return () => subscription.unsubscribe();
      }, [copilotkit]);
      return null;
    };

    renderWithCopilotKit({
      agent,
      humanInTheLoop: [bookCall()],
      children: (
        <>
          <Subscriber />
          <div style={{ height: 400 }}>
            <CopilotChat welcomeScreen={false} />
          </div>
        </>
      ),
    });

    await driveToolCall(agent, "book_call");

    agent.emit(runFinishedEvent());
    agent.complete();

    await screen.findByTestId("hitl-respond");

    act(() => {
      agent.abortRun();
    });

    await waitFor(() => {
      expect(toolExecutionEnds.length).toBeGreaterThan(0);
      const last = toolExecutionEnds[toolExecutionEnds.length - 1];
      expect(last.error).toBeDefined();
      expect(last.error).toContain("aborted");
    });
  });
});
