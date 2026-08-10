import React from "react";
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import type { AbstractAgent, Message } from "@ag-ui/client";

// Local FlatList that actually invokes renderItem — the shared stub in
// src/__mocks__/react-native.ts passes it through as an inert prop, so the
// tool-call branch would never execute. Mirrors CopilotChat.test.tsx:64.
vi.mock("react-native", async () => {
  const actual = await vi.importActual<any>("../../__mocks__/react-native");
  return {
    ...actual,
    FlatList: ({ data, renderItem, ListEmptyComponent, keyExtractor }: any) => {
      if (!data?.length)
        return React.createElement(
          "div",
          { "data-testid": "flatlist" },
          ListEmptyComponent,
        );
      return React.createElement(
        "div",
        { "data-testid": "flatlist" },
        data.map((item: any, index: number) =>
          React.createElement(
            "div",
            { key: keyExtractor?.(item) ?? index },
            renderItem({ item, index, separators: {} }),
          ),
        ),
      );
    },
  };
});

import { CopilotChat } from "../CopilotChat";
import { useRenderTool } from "../../hooks/useRenderTool";
import { TestCopilotKit } from "../../__mocks__/test-copilotkit";

function Registrar() {
  useRenderTool({
    name: "showPlaces",
    description: "Show places",
    parameters: z.object({ title: z.string() }),
    // Tolerates partial props — that is the contract while streaming.
    render: ({ args, status }) => (
      <div data-testid="places">{`${status}:${(args as { title?: string }).title ?? ""}`}</div>
    ),
  });
  return null;
}

// Renders the raw args object it receives, so tests can assert exactly what the
// renderer got for degenerate argument strings (empty / unparseable).
function ArgsRegistrar() {
  useRenderTool({
    name: "echoArgs",
    description: "Echo args",
    parameters: z.object({}),
    render: ({ args }) => <div data-testid="args">{JSON.stringify(args)}</div>,
  });
  return null;
}

const assistantWithCall = (args: string) => ({
  id: "m1",
  role: "assistant",
  toolCalls: [
    {
      id: "tc1",
      type: "function",
      function: { name: "showPlaces", arguments: args },
    },
  ],
});

const assistantEchoArgs = (args: string) => ({
  id: "m1",
  role: "assistant",
  toolCalls: [
    {
      id: "tc1",
      type: "function",
      function: { name: "echoArgs", arguments: args },
    },
  ],
});

describe("CopilotChat tool-call rendering", () => {
  it("paints PARTIAL args with status inProgress while the call streams", () => {
    // '{"title":"Roof' is invalid JSON — the model is mid-write. The old code
    // JSON.parse'd it, warned, and fell back to {}, so nothing painted until
    // the call completed.
    render(
      <TestCopilotKit messages={[assistantWithCall('{"title":"Roof')]}>
        <Registrar />
        <CopilotChat />
      </TestCopilotKit>,
    );
    expect(screen.getByTestId("places").textContent).toBe("inProgress:Roof");
  });

  it("reports complete and passes the result through when a tool message exists", () => {
    render(
      <TestCopilotKit
        messages={[
          assistantWithCall('{"title":"Rooftop"}'),
          { id: "m2", role: "tool", toolCallId: "tc1", content: "ok" },
        ]}
      >
        <Registrar />
        <CopilotChat />
      </TestCopilotKit>,
    );
    expect(screen.getByTestId("places").textContent).toBe("complete:Rooftop");
  });

  it("keeps rendering a tool call after the registering component unmounts", () => {
    // The chat-history regression: RN's old Map deleted the renderer on unmount,
    // so navigating away degraded earlier tool calls to the placeholder. Core
    // deliberately keeps renderer entries.
    const { rerender } = render(
      <TestCopilotKit messages={[assistantWithCall('{"title":"Rooftop"}')]}>
        <Registrar />
        <CopilotChat />
      </TestCopilotKit>,
    );
    expect(screen.getByTestId("places")).toBeTruthy();

    rerender(
      <TestCopilotKit messages={[assistantWithCall('{"title":"Rooftop"}')]}>
        <CopilotChat />
      </TestCopilotKit>,
    );
    expect(screen.getByTestId("places")).toBeTruthy();
    expect(screen.queryByText("Called: showPlaces")).toBeNull();
  });

  it("reports executing status when the call id is in executingToolCallIds and has no result", () => {
    // No tool message + id in executingToolCallIds → core derives "executing"
    // (executing sits between inProgress and complete in the status ladder).
    render(
      <TestCopilotKit
        messages={[assistantWithCall('{"title":"Rooftop"}')]}
        executingToolCallIds={new Set(["tc1"])}
      >
        <Registrar />
        <CopilotChat />
      </TestCopilotKit>,
    );
    expect(screen.getByTestId("places").textContent).toBe("executing:Rooftop");
  });

  it("yields an empty args object for empty-string arguments without throwing", () => {
    render(
      <TestCopilotKit messages={[assistantEchoArgs("")]}>
        <ArgsRegistrar />
        <CopilotChat />
      </TestCopilotKit>,
    );
    expect(screen.getByTestId("args").textContent).toBe("{}");
  });

  it("yields an empty args object for unrepairable JSON arguments without throwing", () => {
    render(
      <TestCopilotKit messages={[assistantEchoArgs("not json at all")]}>
        <ArgsRegistrar />
        <CopilotChat />
      </TestCopilotKit>,
    );
    expect(screen.getByTestId("args").textContent).toBe("{}");
  });

  it("falls back to the placeholder for an unregistered tool", () => {
    render(
      <TestCopilotKit
        messages={[
          {
            id: "m1",
            role: "assistant",
            toolCalls: [
              {
                id: "tc9",
                type: "function",
                function: { name: "notRegistered", arguments: "{}" },
              },
            ],
          },
        ]}
      >
        <CopilotChat />
      </TestCopilotKit>,
    );
    expect(screen.getByText("Called: notRegistered")).toBeTruthy();
  });
});

/**
 * How PRODUCTION changes `agent.messages`, and why it needs its own suite.
 *
 * Core NEVER reassigns `agent.messages`. Tool results are inserted with
 * `agent.messages.splice(insertAt, 0, toolMessage)` (packages/core, run-handler),
 * new messages are appended by `AbstractAgent.addMessage` (a `push`), and the
 * AG-UI apply pipeline mutates the SAME array for the whole run. `useAgent`
 * then re-renders with a bare `forceUpdate()` — it does not hand down a new
 * array either.
 *
 * The array's IDENTITY therefore stays constant while its CONTENT changes. Any
 * `useMemo(..., [messages])` in the chat is invalidated by neither, so it
 * freezes at whatever the first render of the run saw.
 *
 * The rest of this file (and every other RN chat suite) drives messages by
 * re-rendering `TestCopilotKit` with a NEW array, which does change identity —
 * so those tests pass whether or not the memo dependencies are correct. These
 * assertions deliberately mutate in place instead, via the same public
 * `addMessage` that core's own paths bottom out in.
 */
describe("CopilotChat against in-place message mutation", () => {
  it("reports complete and passes the result once a tool result is pushed in place", async () => {
    // A plain box, not React.createRef — TestCopilotKit only writes to it.
    const agentRef: React.MutableRefObject<AbstractAgent | null> = {
      current: null,
    };

    render(
      <TestCopilotKit
        messages={[assistantWithCall('{"title":"Rooftop"}')]}
        agentRef={agentRef}
      >
        <Registrar />
        <CopilotChat />
      </TestCopilotKit>,
    );
    // No tool message yet, and the id is not executing → core derives inProgress.
    expect(screen.getByTestId("places").textContent).toBe("inProgress:Rooftop");

    await act(async () => {
      agentRef.current!.addMessage({
        id: "m2",
        role: "tool",
        toolCallId: "tc1",
        content: "ok",
      } as Message);
    });

    // The toolCallId → ToolMessage correlation must see the pushed message.
    expect(screen.getByTestId("places").textContent).toBe("complete:Rooftop");
  });

  it("renders a tool call that is pushed in place after mount", async () => {
    // A plain box, not React.createRef — TestCopilotKit only writes to it.
    const agentRef: React.MutableRefObject<AbstractAgent | null> = {
      current: null,
    };

    render(
      <TestCopilotKit
        messages={[{ id: "u1", role: "user", content: "find me a bar" }]}
        agentRef={agentRef}
      >
        <Registrar />
        <CopilotChat />
      </TestCopilotKit>,
    );
    expect(screen.queryByTestId("places")).toBeNull();

    await act(async () => {
      agentRef.current!.addMessage(
        assistantWithCall('{"title":"Rooftop"}') as unknown as Message,
      );
    });

    // The flat-list items must see the pushed assistant message.
    expect(screen.getByTestId("places").textContent).toBe("inProgress:Rooftop");
  });
});
