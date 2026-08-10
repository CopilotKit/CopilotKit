import React from "react";
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import type { AbstractAgent } from "@ag-ui/client";

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
import { assistantToolCall, toolMessage } from "../../__mocks__/tool-fixtures";

// Reports status + args only. Assertions about the RESULT must NOT use this one:
// its output cannot distinguish "the correlated result reached the renderer" from
// "status flipped for some other reason", which is how a corrupted tool-message
// content passed unnoticed. Use `ReportRegistrar` below for those.
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

// Reports status, args AND result together, so one assertion observes the whole
// output of the `toolCallId -> ToolMessage` correlation: the status it derived,
// the args it parsed, and the result content it actually handed the renderer.
// `undefined` is spelled out rather than stringified, so an absent result stays
// distinguishable from an empty-string one.
function ReportRegistrar() {
  useRenderTool({
    name: "reportPlaces",
    description: "Report places",
    parameters: z.object({ title: z.string() }),
    render: ({ args, status, result }) => (
      <div data-testid="report">
        {`${status}:${(args as { title?: string }).title ?? ""}|${
          result === undefined ? "<no result>" : result
        }`}
      </div>
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

// Renders the raw `result` it receives, so tests can assert exactly what the
// renderer got for a tool message whose content is not the `string` the
// renderer contract declares.
function ResultRegistrar() {
  useRenderTool({
    name: "echoResult",
    description: "Echo result",
    parameters: z.object({}),
    render: ({ status, result }) => (
      <div data-testid="result">{`${status}|${String(result)}`}</div>
    ),
  });
  return null;
}

// All four call the same shared factory, so every fixture here agrees on the
// tool-call id the tool results below are correlated against.
const assistantWithCall = (args: string) =>
  assistantToolCall("showPlaces", args);
const assistantEchoArgs = (args: string) => assistantToolCall("echoArgs", args);
const assistantEchoResult = assistantToolCall("echoResult", "{}");
const assistantReportCall = (args: string) =>
  assistantToolCall("reportPlaces", args);

// The one fixture here that cannot be the typed `toolMessage()` factory: the
// "tool-result content" suite drives content the `ToolMessage` type FORBIDS
// (arrays, objects, null, circular) through `toolResultContent`, and no
// properly-typed fixture can express that. Its string cases share this helper for
// uniformity within that suite; every tool result OUTSIDE it is typed.
const toolResult = (content: unknown) => ({
  id: "m2",
  role: "tool",
  toolCallId: "tc1",
  content,
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
          assistantReportCall('{"title":"Rooftop"}'),
          toolMessage("tc1", "ok"),
        ]}
      >
        <ReportRegistrar />
        <CopilotChat />
      </TestCopilotKit>,
    );
    // Reads the RESULT, not only the status. Asserting `complete` alone is
    // satisfied by ANY tool message reaching `renderToolCall`, so it stayed
    // green when the correlated content was replaced with a constant.
    expect(screen.getByTestId("report").textContent).toBe(
      "complete:Rooftop|ok",
    );
  });

  it("does NOT complete a tool call that no tool message is correlated to", () => {
    // The other direction of the same map. Every positive fixture in this file
    // matches on id, so a lookup that ignores the key — keyed on the tool
    // message's own id, or falling back to "any tool message we have" — reads as
    // a correct correlation. Here the only tool result belongs to a DIFFERENT
    // call, so a leak is visible as both a completed status and a stray result.
    render(
      <TestCopilotKit
        messages={[
          assistantReportCall('{"title":"Rooftop"}'),
          toolMessage("tc-someone-else", "leaked"),
        ]}
      >
        <ReportRegistrar />
        <CopilotChat />
      </TestCopilotKit>,
    );
    expect(screen.getByTestId("report").textContent).toBe(
      "inProgress:Rooftop|<no result>",
    );
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
        messages={[assistantToolCall("notRegistered", "{}", "tc9")]}
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
        messages={[assistantReportCall('{"title":"Rooftop"}')]}
        agentRef={agentRef}
      >
        <ReportRegistrar />
        <CopilotChat />
      </TestCopilotKit>,
    );
    // No tool message yet, and the id is not executing → core derives inProgress,
    // and the renderer is handed no result at all.
    expect(screen.getByTestId("report").textContent).toBe(
      "inProgress:Rooftop|<no result>",
    );

    await act(async () => {
      // A real `ToolMessage`, so `addMessage` needs no cast and the id the
      // correlation keys on cannot go missing.
      agentRef.current!.addMessage(toolMessage("tc1", "ok"));
    });

    // The toolCallId → ToolMessage correlation must see the pushed message AND
    // carry its content through — asserting the status alone would pass even if
    // the map delivered a different message's result.
    expect(screen.getByTestId("report").textContent).toBe(
      "complete:Rooftop|ok",
    );
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
      // Typed `AssistantMessage` from the shared factory — assignable to
      // `Message` on its own, so the old double cast is gone.
      agentRef.current!.addMessage(assistantWithCall('{"title":"Rooftop"}'));
    });

    // The flat-list items must see the pushed assistant message.
    expect(screen.getByTestId("places").textContent).toBe("inProgress:Rooftop");
  });
});

describe("CopilotChat tool-result content", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const renderWithResult = (content: unknown) =>
    render(
      <TestCopilotKit messages={[assistantEchoResult, toolResult(content)]}>
        <ResultRegistrar />
        <CopilotChat />
      </TestCopilotKit>,
    );

  it("passes a string result through verbatim without warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderWithResult('{"ok":true}');
    expect(screen.getByTestId("result").textContent).toBe(
      'complete|{"ok":true}',
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps a genuinely EMPTY string result empty and does not warn", () => {
    // "" is a legitimate tool result. It must stay silent, so a warning is
    // reserved for content the code could not represent.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderWithResult("");
    expect(screen.getByTestId("result").textContent).toBe("complete|");
    expect(warn).not.toHaveBeenCalled();
  });

  it("serialises ARRAY tool content instead of collapsing it to an empty result", () => {
    // The silent-failure regression: array content (structured / attachment
    // parts) was coerced to "", which a renderer cannot distinguish from a tool
    // that genuinely returned nothing.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderWithResult([{ type: "text", text: "hello" }]);
    expect(screen.getByTestId("result").textContent).toBe(
      'complete|[{"type":"text","text":"hello"}]',
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("tc1");
  });

  it("serialises OBJECT tool content instead of collapsing it to an empty result", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderWithResult({ status: "ok" });
    expect(screen.getByTestId("result").textContent).toBe(
      'complete|{"status":"ok"}',
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warns for NULL tool content even though it has nothing to serialise", () => {
    // Nothing is lost by rendering "", but the message is still malformed, so
    // the failure must be audible rather than silent.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderWithResult(null);
    expect(screen.getByTestId("result").textContent).toBe("complete|");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not throw on tool content that cannot be JSON-serialised", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => renderWithResult(circular)).not.toThrow();
    expect(screen.getByTestId("result").textContent).toBe(
      "complete|[object Object]",
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
