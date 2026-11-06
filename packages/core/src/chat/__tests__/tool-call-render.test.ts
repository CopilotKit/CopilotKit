import { describe, expect, it, vi } from "vitest";
import type { Message, ToolCall, ToolMessage } from "@ag-ui/core";
import { ToolCallStatus } from "../../types";
import {
  ɵadaptDefaultToolCallRenderProps,
  ɵbuildToolCallRenderProps,
  ɵcomponentToolDescription,
  ɵdescribeUnrenderedToolCalls,
  ɵfindToolMessage,
  ɵgetToolCallBadge,
  ɵgetToolCallStatus,
  ɵnormalizeToolCallStatus,
  ɵparseToolCallArguments,
  ɵresolveToolCallAgentId,
  ɵtoDefaultToolCallStatus,
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

  describe("with tool content outside the AG-UI protocol", () => {
    // Restored history, a non-SSE transport, or app code casting on
    // `addMessage` can hand a tool message content that is neither a string
    // nor a list of content parts. Renderers take `result: string`.
    const resultOf = (content: unknown) =>
      ɵbuildToolCallRenderProps(
        createToolCall("{}"),
        createToolMessage(content as ToolMessage["content"]),
        { isExecuting: false },
      ).result;

    it.each([
      ["an object", { status: "ok" }, '{"status":"ok"}'],
      ["a number", 42, "42"],
      ["an array that is not content parts", ["hello", 42], '["hello",42]'],
      [
        "typed records that are not content parts",
        [{ type: "record", answer: 42 }],
        '[{"type":"record","answer":42}]',
      ],
      [
        "a media part without the mime type of its inline data",
        [{ type: "image", source: { type: "data", value: "abc" } }],
        '[{"type":"image","source":{"type":"data","value":"abc"}}]',
      ],
      ["null", null, ""],
    ])("gives %s as JSON text, and warns", (_label, content, expected) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      expect(resultOf(content)).toBe(expected);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("call-1");
      warn.mockRestore();
    });

    it("does not throw on content that cannot be serialized", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      expect(resultOf(circular)).toBe("[object Object]");
      warn.mockRestore();
    });

    it("warns once per tool message, not on every render", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const message = createToolMessage({
        status: "ok",
      } as unknown as ToolMessage["content"]);
      const build = () =>
        ɵbuildToolCallRenderProps(createToolCall("{}"), message, {
          isExecuting: false,
        });

      build();
      build();

      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it("does not warn for a string or content parts", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      expect(resultOf("")).toBe("");
      expect(
        resultOf([
          { type: "text", text: "see " },
          { type: "document", source: { type: "file", value: "file-abc" } },
        ]),
      ).toBe("see ");
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
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

describe("ɵnormalizeToolCallStatus", () => {
  it("reads core and Angular spellings, and anything else as unknown", () => {
    expect(
      ["inProgress", "in-progress", "executing", "complete", "future"].map(
        ɵnormalizeToolCallStatus,
      ),
    ).toEqual(["inProgress", "inProgress", "executing", "complete", "unknown"]);
  });
});

describe("ɵgetToolCallBadge", () => {
  it("maps each status to a tone and a chat label", () => {
    expect(
      (["inProgress", "executing", "complete", "unknown"] as const).map(
        ɵgetToolCallBadge,
      ),
    ).toEqual([
      { tone: "running", labelKey: "toolCallStatusRunningLabel" },
      { tone: "running", labelKey: "toolCallStatusRunningLabel" },
      { tone: "done", labelKey: "toolCallStatusDoneLabel" },
      { tone: "other", labelKey: "toolCallStatusUnknownLabel" },
    ]);
  });
});

describe("ɵcomponentToolDescription", () => {
  it("tells the model the tool shows the component, then adds the app's text", () => {
    const prefix =
      'Use this tool to display the "card" component in the chat. This tool renders a visual UI component for the user.';

    expect(ɵcomponentToolDescription("card")).toBe(prefix);
    expect(ɵcomponentToolDescription("card", "Shows a card.")).toBe(
      `${prefix}\n\nShows a card.`,
    );
  });
});

describe("ɵadaptDefaultToolCallRenderProps", () => {
  it("turns core's raw props into the documented shape", () => {
    expect(
      ɵadaptDefaultToolCallRenderProps({
        name: "search",
        toolCallId: "call-1",
        args: { query: "cats" },
        status: ToolCallStatus.Complete,
        result: "found",
      }),
    ).toEqual({
      name: "search",
      toolCallId: "call-1",
      parameters: { query: "cats" },
      status: "complete",
      result: "found",
    });
  });

  it("keeps props that are already in the documented shape", () => {
    expect(
      ɵadaptDefaultToolCallRenderProps({
        name: "search",
        toolCallId: "call-1",
        parameters: { query: "dogs" },
        args: { query: "ignored" },
        status: "executing",
        result: undefined,
      }),
    ).toMatchObject({ parameters: { query: "dogs" }, status: "executing" });
  });
});

describe("ɵtoDefaultToolCallStatus", () => {
  it("reads Angular's spelling of in progress", () => {
    expect(ɵtoDefaultToolCallStatus("in-progress")).toBe("inProgress");
  });

  it("shows an unknown status as in progress and warns once per value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(ɵtoDefaultToolCallStatus("future-status-a")).toBe("inProgress");
      expect(ɵtoDefaultToolCallStatus("future-status-a")).toBe("inProgress");
      expect(ɵtoDefaultToolCallStatus("future-status-b")).toBe("inProgress");
      expect(warn.mock.calls.map(([message]) => message)).toEqual([
        expect.stringContaining('"future-status-a"'),
        expect.stringContaining('"future-status-b"'),
      ]);
    } finally {
      warn.mockRestore();
    }
  });
});
