import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EventType, HttpAgent } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";
import { useCopilotKit } from "@copilotkit/react-core/v2/context";
import type { CopilotKitCoreReact } from "@copilotkit/react-core/v2/context";

// The shared react-native stub passes FlatList props through unused. This one
// renders the rows and then the footer, which is where CopilotChat draws the
// interrupt element.
vi.mock("react-native", async () => {
  const actual = await vi.importActual<any>("../../__mocks__/react-native");
  return {
    ...actual,
    FlatList: ({
      data,
      renderItem,
      keyExtractor,
      ListEmptyComponent,
      ListFooterComponent,
    }: any) =>
      React.createElement(
        "div",
        { "data-testid": "flatlist" },
        data?.length
          ? data.map((item: any, index: number) =>
              React.createElement(
                "div",
                { key: keyExtractor?.(item) ?? index },
                renderItem({ item, index, separators: {} }),
              ),
            )
          : ListEmptyComponent,
        ListFooterComponent,
      ),
  };
});

import { CopilotChat } from "../CopilotChat";
import { useInterrupt } from "../../headless";
import { TestCopilotKit } from "../../__mocks__/test-copilotkit";

function CoreProbe({
  coreRef,
}: {
  coreRef: { current: CopilotKitCoreReact | null };
}) {
  coreRef.current = useCopilotKit().copilotkit;
  return null;
}

/**
 * An agent whose first run stops on an approval interrupt and whose later runs
 * finish normally. It streams real AG-UI events over SSE, so core and
 * useInterrupt see the same run lifecycle as in an app.
 */
function createInterruptingAgent() {
  const inputs: RunAgentInput[] = [];
  const agent = new HttpAgent({
    url: "http://localhost/agent",
    fetch: async (_url, init) => {
      const input = JSON.parse(String(init.body)) as RunAgentInput;
      inputs.push(input);
      const { threadId, runId } = input;
      const events = [
        { type: EventType.RUN_STARTED, threadId, runId },
        {
          type: EventType.RUN_FINISHED,
          threadId,
          runId,
          ...(inputs.length === 1
            ? {
                outcome: {
                  type: "interrupt",
                  interrupts: [
                    { id: "approve", reason: "approval", message: "Deploy?" },
                  ],
                },
              }
            : {}),
        },
      ];
      return new Response(
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  return { agent, inputs };
}

/** Uses useInterrupt with the default renderInChat: true. */
function Approval() {
  useInterrupt({
    render: ({ interrupt, resolve }) => (
      <button
        data-testid="interrupt-ui"
        onClick={() => void resolve({ approved: true })}
      >
        {interrupt?.message}
      </button>
    ),
  });
  return null;
}

const messages = [
  { id: "u1", role: "user", content: "Deploy the app" },
  { id: "a1", role: "assistant", content: "I need your approval first." },
];

function Chat({
  agent,
  coreRef,
  withApproval = true,
}: {
  agent: HttpAgent;
  coreRef: { current: CopilotKitCoreReact | null };
  withApproval?: boolean;
}) {
  return (
    <TestCopilotKit messages={messages} agent={agent}>
      <CoreProbe coreRef={coreRef} />
      {withApproval && <Approval />}
      <CopilotChat />
    </TestCopilotKit>
  );
}

/** Mounts the chat and runs the agent until it stops on the interrupt. */
async function renderInterruptedChat() {
  const { agent, inputs } = createInterruptingAgent();
  const coreRef: { current: CopilotKitCoreReact | null } = { current: null };
  const view = render(<Chat agent={agent} coreRef={coreRef} />);
  expect(screen.queryByTestId("interrupt-ui")).toBeNull();

  await act(async () => {
    await coreRef.current!.runAgent({ agent });
  });
  await waitFor(() => expect(screen.getByTestId("interrupt-ui")).toBeTruthy());
  return { ...view, agent, inputs, coreRef };
}

describe("CopilotChat interrupt rendering", () => {
  it("draws the interrupt element that useInterrupt publishes to core", () => {
    const coreRef: { current: CopilotKitCoreReact | null } = { current: null };
    render(
      <TestCopilotKit messages={[]}>
        <CoreProbe coreRef={coreRef} />
        <CopilotChat />
      </TestCopilotKit>,
    );
    expect(screen.queryByTestId("interrupt-ui")).toBeNull();

    act(() => {
      coreRef.current!.setInterruptElement(
        <div data-testid="interrupt-ui">Approve?</div>,
      );
    });
    expect(screen.getByTestId("interrupt-ui").textContent).toBe("Approve?");

    act(() => {
      coreRef.current!.setInterruptElement(null);
    });
    expect(screen.queryByTestId("interrupt-ui")).toBeNull();
  });

  it("draws a useInterrupt element after the last message and removes it once resolved", async () => {
    const { inputs } = await renderInterruptedChat();

    const interrupt = screen.getByTestId("interrupt-ui");
    expect(interrupt.textContent).toBe("Deploy?");
    const lastMessage = screen.getByText("I need your approval first.");
    expect(
      lastMessage.compareDocumentPosition(interrupt) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await act(async () => {
      fireEvent.click(interrupt);
    });
    await waitFor(() => expect(inputs).toHaveLength(2));
    expect(inputs[1]!.resume).toEqual([
      {
        interruptId: "approve",
        status: "resolved",
        payload: { approved: true },
      },
    ]);
    await waitFor(() =>
      expect(screen.queryByTestId("interrupt-ui")).toBeNull(),
    );
  });

  it("removes the useInterrupt element when its component unmounts", async () => {
    const { agent, coreRef, rerender } = await renderInterruptedChat();

    rerender(<Chat agent={agent} coreRef={coreRef} withApproval={false} />);
    expect(screen.queryByTestId("interrupt-ui")).toBeNull();
  });
});
