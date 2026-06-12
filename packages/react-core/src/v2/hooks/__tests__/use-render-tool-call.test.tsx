import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ToolCallStatus } from "@copilotkit/core";

// We import the module that owns `defaultToolCallRenderAdapter`. Because
// the adapter is module-private, we exercise it through useRenderToolCall:
// register no `*` renderer and ensure the framework fallback (which IS
// `defaultToolCallRenderAdapter`) produces the expected mapped status
// onto the wrapper's `data-status`. We can also drive it directly via
// rendering the exported default renderer if it's exported.

import { DefaultToolCallRenderer } from "../use-default-render-tool";
import type { DefaultRenderProps } from "../use-default-render-tool";

/**
 * Lightweight harness for the adapter behavior: re-implement the call shape
 * used by `useRenderToolCall` to invoke the adapter via the production code
 * path. The adapter itself is not exported, so we test the *effect* — what
 * `DefaultToolCallRenderer` ultimately receives — by importing the adapter
 * via a shim test that mimics the production call site.
 */

// Re-export an adapter-equivalent harness using the production source so we
// can assert the enum mapping behavior. We intentionally import from the
// module that holds the adapter and rely on the fact that the adapter
// produces a <DefaultToolCallRenderer/> with mapped status.

// Pull adapter via internal re-export hatch (added by the fix). If the
// adapter is renamed/removed, this import will fail — that's the contract.
import { __testOnly_defaultToolCallRenderAdapter as adapter } from "../use-render-tool-call";

describe("defaultToolCallRenderAdapter status mapping", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [ToolCallStatus.Complete, "complete"],
    [ToolCallStatus.Executing, "executing"],
    [ToolCallStatus.InProgress, "inProgress"],
  ])("maps %s → data-status=%s", (input, expected) => {
    const el = adapter({
      name: "searchDocs",
      toolCallId: `tc-${expected}`,
      args: { q: "x" },
      status: input,
      result: input === ToolCallStatus.Complete ? "ok" : undefined,
    });
    render(el);
    const wrapper = screen.getByTestId("copilot-tool-render");
    expect(wrapper.getAttribute("data-status")).toBe(expected);
  });

  it("unknown ToolCallStatus values fall back to inProgress and log a warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const el = adapter({
      name: "searchDocs",
      toolCallId: "tc-unknown",
      args: { q: "x" },
      // Intentionally lie about the type to simulate a future enum addition
      // that the adapter doesn't yet know about.
      status: "futureValue" as unknown as ToolCallStatus,
      result: undefined,
    });
    render(el);
    const wrapper = screen.getByTestId("copilot-tool-render");
    expect(wrapper.getAttribute("data-status")).toBe("inProgress");
    expect(warnSpy).toHaveBeenCalled();
    const firstArg = warnSpy.mock.calls[0]?.[0];
    expect(String(firstArg)).toMatch(/CopilotKit|ToolCallStatus|tool-call/i);
    warnSpy.mockRestore();
  });

  it("renders parameters via the DefaultToolCallRenderer (smoke)", () => {
    // Sanity check that DefaultToolCallRenderer still accepts the doc-shape.
    const props: DefaultRenderProps = {
      name: "echo",
      toolCallId: "tc-smoke",
      parameters: { hello: "world" },
      status: "complete",
      result: "ok",
    };
    render(<DefaultToolCallRenderer {...props} />);
    expect(screen.getByTestId("copilot-tool-render")).toBeDefined();
  });
});
