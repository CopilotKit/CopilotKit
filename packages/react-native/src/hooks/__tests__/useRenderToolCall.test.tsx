import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const hoisted = vi.hoisted(() => ({
  executingToolCallIds: new Set<string>(),
  registry: new Map<string, any>(),
}));

vi.mock("@copilotkit/react-core/v2/headless", () => ({
  useCopilotKit: () => ({ executingToolCallIds: hoisted.executingToolCallIds }),
}));

vi.mock("../RenderToolContext", () => ({
  useRenderToolRegistry: () => hoisted.registry,
}));

import { useRenderToolCall } from "../useRenderToolCall";

/** Renders one tool call and reports the props the registered renderer received. */
function renderCall(toolCall: any, toolMessage?: any) {
  let seen: any = null;
  hoisted.registry.set("showAbout", (props: any) => {
    seen = props;
    return null;
  });

  function Probe() {
    const renderToolCall = useRenderToolCall();
    return <>{renderToolCall({ toolCall, toolMessage })}</>;
  }
  render(<Probe />);
  return seen;
}

const call = (args: string, id = "tc-1") => ({
  id,
  function: { name: "showAbout", arguments: args },
});

describe("useRenderToolCall", () => {
  it("renders a registered component for a tool call", () => {
    const props = renderCall(call('{"dataId":"zosch"}'));
    expect(props).not.toBeNull();
    expect(props.args).toEqual({ dataId: "zosch" });
  });

  it("returns null for a tool with no registered renderer", () => {
    let out: unknown = "unset";
    function Probe() {
      const renderToolCall = useRenderToolCall();
      out = renderToolCall({
        toolCall: {
          id: "x",
          function: { name: "notRegistered", arguments: "{}" },
        },
      });
      return null;
    }
    render(<Probe />);
    expect(out).toBeNull();
  });

  // The point of the hook: paint while the model is still writing the call.
  it("exposes PARTIAL args with status inProgress while arguments are incomplete", () => {
    const props = renderCall(call('{"dataId":"neues-mus'));
    expect(props.status).toBe("inProgress");
    // partial JSON still yields the keys written so far
    expect(props.args).toEqual({ dataId: "neues-mus" });
  });

  it("does not throw on a fragment that has no complete key yet", () => {
    const props = renderCall(call('{"places":[{"title":"Roof'));
    expect(props.status).toBe("inProgress");
    expect(props.args).toBeTypeOf("object");
  });

  it("reports executing once arguments are complete and the handler is running", () => {
    hoisted.executingToolCallIds.add("tc-run");
    const props = renderCall(call('{"dataId":"zosch"}', "tc-run"), undefined);
    expect(props.status).toBe("executing");
    hoisted.executingToolCallIds.delete("tc-run");
  });

  it("reports complete and passes the result through when a tool message exists", () => {
    const props = renderCall(call('{"dataId":"zosch"}'), { content: "ok" });
    expect(props.status).toBe("complete");
    expect(props.result).toBe("ok");
  });

  it("treats absent arguments as an empty object, not a crash", () => {
    const props = renderCall({
      id: "tc-2",
      function: { name: "showAbout" },
    } as any);
    expect(props.args).toEqual({});
    expect(props.status).toBe("complete");
  });
});
