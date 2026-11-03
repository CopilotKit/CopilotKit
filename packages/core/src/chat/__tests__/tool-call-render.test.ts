import { describe, expect, it } from "vitest";
import type { Message, ToolCall, ToolMessage } from "@ag-ui/core";
import { ToolCallStatus } from "../../types";
import {
  ɵbuildToolCallRenderProps,
  ɵdescribeUnrenderedToolCalls,
  ɵfindToolMessage,
  ɵgetToolCallStatus,
  ɵparseToolCallArguments,
  ɵresolveToolCallAgentId,
} from "../tool-call-render";

function createToolCall(args: string): ToolCall {
  return {
    id: "call-1",
    type: "function",
    function: { name: "search", arguments: args },
  };
}

function createToolMessage(content: ToolMessage["content"]): ToolMessage {
  return { id: "tool-1", role: "tool", toolCallId: "call-1", content };
}

describe("ɵgetToolCallStatus", () => {
  it("is complete once a result exists, even while still executing", () => {
    expect(ɵgetToolCallStatus({ hasResult: true, isExecuting: true })).toBe(
      ToolCallStatus.Complete,
    );
  });

  it("is executing while the handler runs and no result exists", () => {
    expect(ɵgetToolCallStatus({ hasResult: false, isExecuting: true })).toBe(
      ToolCallStatus.Executing,
    );
  });

  it("is in progress with no result and no running handler", () => {
    expect(ɵgetToolCallStatus({ hasResult: false, isExecuting: false })).toBe(
      ToolCallStatus.InProgress,
    );
  });
});

describe("ɵfindToolMessage", () => {
  it("finds the tool message for the call and skips other roles", () => {
    const answer = createToolMessage("42");
    const messages: Message[] = [
      { id: "a", role: "assistant", content: "", toolCalls: [] },
      { id: "other", role: "tool", toolCallId: "call-2", content: "no" },
      answer,
    ];

    expect(ɵfindToolMessage(messages, "call-1")).toBe(answer);
    expect(ɵfindToolMessage(messages, "missing")).toBeUndefined();
  });
});

describe("ɵparseToolCallArguments", () => {
  it("reads streaming partial JSON as far as it goes", () => {
    expect(ɵparseToolCallArguments('{"city":"Par', { partial: true })).toEqual({
      city: "Par",
    });
  });

  it("reads a non-object partial value as an empty object", () => {
    expect(ɵparseToolCallArguments('"Paris"', { partial: true })).toEqual({});
  });

  it("keeps text that is not JSON once the arguments are complete", () => {
    expect(ɵparseToolCallArguments('{"city":', { partial: false })).toEqual({
      _raw: '{"city":',
    });
  });

  it("wraps a complete non-object value", () => {
    expect(ɵparseToolCallArguments('"Paris"', { partial: false })).toEqual({
      _value: "Paris",
    });
  });
});

describe("ɵbuildToolCallRenderProps", () => {
  it("builds complete props with the text of the result", () => {
    const props = ɵbuildToolCallRenderProps(
      createToolCall('{"q":"cats"}'),
      createToolMessage([
        { type: "text", text: "3 " },
        { type: "text", text: "cats" },
      ]),
      { isExecuting: false },
    );

    expect(props).toEqual({
      name: "search",
      toolCallId: "call-1",
      args: { q: "cats" },
      status: ToolCallStatus.Complete,
      result: "3 cats",
    });
  });

  it("builds executing props with strictly parsed arguments", () => {
    const props = ɵbuildToolCallRenderProps(createToolCall("oops"), undefined, {
      isExecuting: true,
    });

    expect(props).toEqual({
      name: "search",
      toolCallId: "call-1",
      args: { _raw: "oops" },
      status: ToolCallStatus.Executing,
      result: undefined,
    });
  });

  it("builds in-progress props from partial arguments", () => {
    const props = ɵbuildToolCallRenderProps(
      createToolCall('{"q":"ca'),
      undefined,
      { isExecuting: false },
    );

    expect(props.status).toBe(ToolCallStatus.InProgress);
    expect(props.args).toEqual({ q: "ca" });
  });
});

describe("ɵresolveToolCallAgentId", () => {
  it("prefers the chat agent, then the message agent, then the default", () => {
    expect(ɵresolveToolCallAgentId("chat", "message")).toBe("chat");
    expect(ɵresolveToolCallAgentId(undefined, "message")).toBe("message");
    expect(ɵresolveToolCallAgentId(undefined, undefined)).toBe("default");
  });
});

describe("ɵdescribeUnrenderedToolCalls", () => {
  it("names the tool and the registered renderers", () => {
    const [warning] = ɵdescribeUnrenderedToolCalls(
      ["lookup"],
      [{ name: "search" }],
    );

    expect(warning?.toolName).toBe("lookup");
    expect(warning?.message).toContain('the tool "lookup"');
    expect(warning?.message).toContain('Registered renderers: "search".');
  });

  it("says when no renderer is registered", () => {
    const [warning] = ɵdescribeUnrenderedToolCalls(["lookup"], []);

    expect(warning?.message).toContain(
      "No tool-call renderers are registered.",
    );
  });

  it("skips names that now have a renderer, and everything once a wildcard exists", () => {
    expect(
      ɵdescribeUnrenderedToolCalls(
        ["search", "lookup"],
        [{ name: "search" }],
      ).map(({ toolName }) => toolName),
    ).toEqual(["lookup"]);
    expect(ɵdescribeUnrenderedToolCalls(["lookup"], [{ name: "*" }])).toEqual(
      [],
    );
  });

  it("warns once per name", () => {
    expect(ɵdescribeUnrenderedToolCalls(["lookup", "lookup"], [])).toHaveLength(
      1,
    );
  });
});
