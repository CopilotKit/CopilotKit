import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  useDefaultRenderTool,
  DefaultToolCallRenderer,
} from "../use-default-render-tool";
import type { DefaultRenderProps } from "../use-default-render-tool";
import { useRenderTool } from "../use-render-tool";

vi.mock("../use-render-tool", () => ({
  useRenderTool: vi.fn(),
}));

const mockUseRenderTool = useRenderTool as ReturnType<typeof vi.fn>;

describe("useDefaultRenderTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers a wildcard renderer when called without config", () => {
    const Harness: React.FC = () => {
      useDefaultRenderTool();
      return null;
    };

    render(<Harness />);

    expect(mockUseRenderTool).toHaveBeenCalledTimes(1);
    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        name: string;
        render: (props: {
          name: string;
          parameters: unknown;
          status: string;
          result: string | undefined;
        }) => React.ReactElement;
      },
    ];

    expect(config.name).toBe("*");
    expect(typeof config.render).toBe("function");
  });

  it("forwards toolCallId to custom wildcard render function", () => {
    // Verifies the registered render — when invoked with the framework-internal
    // RawRendererProps shape that useRenderToolCall actually passes — adapts
    // and forwards the same toolCallId to the user's custom render.
    const customRender = vi.fn((_props: DefaultRenderProps) => (
      <div data-testid="custom">custom</div>
    ));

    const Harness: React.FC = () => {
      useDefaultRenderTool({
        render: customRender,
      });
      return null;
    };

    render(<Harness />);

    expect(mockUseRenderTool).toHaveBeenCalledTimes(1);
    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        name: string;
        render: (props: {
          name: string;
          toolCallId: string;
          args: unknown;
          status: string;
          result: string | undefined;
        }) => React.ReactElement;
      },
    ];

    // Production call site (useRenderToolCall) passes args + enum status.
    config.render({
      name: "searchDocs",
      toolCallId: "tc-forwarded-1",
      args: { query: "copilot" },
      status: "executing",
      result: undefined,
    });

    expect(customRender).toHaveBeenCalledTimes(1);
    const forwardedProps = customRender.mock.calls[0][0];
    expect(forwardedProps).toMatchObject({
      toolCallId: "tc-forwarded-1",
    });
  });

  it("forwards custom render function and deps", () => {
    const customRender = vi.fn(() => <div data-testid="custom">custom</div>);
    const deps = ["compact"] as const;

    const Harness: React.FC = () => {
      useDefaultRenderTool(
        {
          render: customRender,
        },
        deps,
      );
      return null;
    };

    render(<Harness />);

    expect(mockUseRenderTool).toHaveBeenCalledTimes(1);
    const [config, forwardedDeps] = mockUseRenderTool.mock.calls[0] as [
      {
        name: string;
        render: (props: {
          name: string;
          toolCallId: string;
          args: unknown;
          status: string;
          result: string | undefined;
        }) => React.ReactElement;
      },
      ReadonlyArray<unknown>,
    ];

    expect(config.name).toBe("*");
    // The registered render is a wrapper around the user's render — not the
    // user function by reference — so we verify it forwards correctly
    // instead of doing reference equality.
    expect(typeof config.render).toBe("function");
    config.render({
      name: "x",
      toolCallId: "tc-1",
      args: { a: 1 },
      status: "complete",
      result: "ok",
    });
    expect(customRender).toHaveBeenCalledTimes(1);
    expect(forwardedDeps).toBe(deps);
  });

  it("default renderer shows status and expands to show parameters/result", () => {
    // Render DefaultToolCallRenderer directly with the documented prop shape.
    // (The registered `*` render wraps the framework-internal RawRendererProps;
    // we exercise that adaptation separately. Here we want to assert the UI
    // contract of the built-in default itself.)
    render(
      <DefaultToolCallRenderer
        name="searchDocs"
        toolCallId="tc-default-executing"
        parameters={{ query: "copilot" }}
        status="executing"
        result={undefined}
      />,
    );

    expect(screen.getByText("searchDocs")).toBeDefined();
    expect(screen.getByText("Running")).toBeDefined();

    fireEvent.click(screen.getByText("searchDocs"));
    expect(screen.getByText("Arguments")).toBeDefined();
    expect(screen.getByText(/copilot/)).toBeDefined();
  });

  it("default renderer shows done status and result payload", () => {
    render(
      <DefaultToolCallRenderer
        name="searchDocs"
        toolCallId="tc-default-complete"
        parameters={{ query: "copilot" }}
        status="complete"
        result="done"
      />,
    );

    expect(screen.getByText("Done")).toBeDefined();
    fireEvent.click(screen.getByText("searchDocs"));
    expect(screen.getByText("Result")).toBeDefined();
    expect(screen.getByText("done")).toBeDefined();
  });

  it("default renderer includes dark-theme-aware classes", () => {
    render(
      <DefaultToolCallRenderer
        name="searchDocs"
        toolCallId="tc-default-dark-theme"
        parameters={{ query: "copilot" }}
        status="complete"
        result="done"
      />,
    );

    const wrapper = screen.getByTestId("copilot-tool-render");
    const card = wrapper.firstElementChild as HTMLElement | null;
    expect(card).not.toBeNull();
    expect(card!.className).toContain("cpk:dark:border-zinc-800/60");
    expect(card!.className).toContain("cpk:dark:bg-zinc-900/50");

    const name = screen.getByTestId("copilot-tool-render-name");
    expect(name.className).toContain("cpk:dark:text-zinc-100");

    const status = screen.getByTestId("copilot-tool-render-status");
    expect(status.className).toContain("cpk:dark:bg-emerald-500/15");
    expect(status.className).toContain("cpk:dark:text-emerald-400");

    const headerButton = name.closest("button");
    expect(headerButton).not.toBeNull();
    fireEvent.click(headerButton!);

    const details = wrapper.querySelectorAll("pre");
    expect(details.length).toBeGreaterThan(0);
    for (const detail of details) {
      expect(detail.className).toContain("cpk:dark:bg-zinc-800/60");
      expect(detail.className).toContain("cpk:dark:text-zinc-200");
    }
  });

  it("default renderer emits stable copilot-tool-render testid and metadata attrs", () => {
    render(
      <DefaultToolCallRenderer
        name="searchDocs"
        toolCallId="tc-default-testid"
        parameters={{ query: "copilot" }}
        status="complete"
        result="ok"
      />,
    );

    const wrapper = screen.getByTestId("copilot-tool-render");
    expect(wrapper).toBeDefined();
    expect(wrapper.getAttribute("data-tool-name")).toBe("searchDocs");
    expect(wrapper.getAttribute("data-status")).toBe("complete");
    expect(wrapper.getAttribute("data-args")).toBe(
      JSON.stringify({ query: "copilot" }),
    );
    expect(wrapper.getAttribute("data-result")).toBe("ok");
    expect(screen.getByTestId("copilot-tool-render-name").textContent).toBe(
      "searchDocs",
    );
    expect(screen.getByTestId("copilot-tool-render-status").textContent).toBe(
      "Done",
    );
  });

  // Fix #1: a11y — expand/collapse header must be a real button, keyboard-toggleable.
  it("default renderer header is a button with aria-expanded that toggles via keyboard", () => {
    render(
      <DefaultToolCallRenderer
        name="searchDocs"
        toolCallId="tc-a11y"
        parameters={{ query: "copilot" }}
        status="executing"
        result={undefined}
      />,
    );

    // Header (the tool name span) lives inside a real <button>.
    const nameNode = screen.getByTestId("copilot-tool-render-name");
    const headerButton = nameNode.closest("button");
    expect(headerButton).not.toBeNull();
    expect(headerButton!.getAttribute("type")).toBe("button");
    expect(headerButton!.getAttribute("aria-expanded")).toBe("false");

    // A native <button> activates on Enter/Space (the browser dispatches a
    // synthetic click). Asserting the click semantics directly is enough to
    // prove the keyboard contract — jsdom does not synthesize the
    // Enter-to-click behavior, but the underlying <button> guarantees it.
    fireEvent.click(headerButton!);
    expect(screen.queryByText("Arguments")).not.toBeNull();
    expect(headerButton!.getAttribute("aria-expanded")).toBe("true");
  });

  // Fix #3: data-tool-call-id is emitted on the wrapper.
  it("default renderer emits data-tool-call-id on the wrapper element", () => {
    render(
      <DefaultToolCallRenderer
        name="searchDocs"
        toolCallId="tc-id-emit"
        parameters={{ query: "copilot" }}
        status="complete"
        result="ok"
      />,
    );

    const wrapper = screen.getByTestId("copilot-tool-render");
    expect(wrapper.getAttribute("data-tool-call-id")).toBe("tc-id-emit");
  });

  // Fix #4: opt-in config.render must receive adapted DefaultRenderProps shape
  // (parameters, string-union status) — not the raw renderer signature.
  it("opt-in config.render receives parameters (not args) and string-union status", () => {
    // useDefaultRenderTool with a user-supplied render should wrap the
    // function so the user sees the documented DefaultRenderProps shape.
    const customRender = vi.fn((props: DefaultRenderProps) => (
      <div data-testid="custom">{props.name}</div>
    ));

    const Harness: React.FC = () => {
      useDefaultRenderTool({ render: customRender });
      return null;
    };

    render(<Harness />);

    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        name: string;
        render: (props: {
          name: string;
          toolCallId: string;
          args: unknown;
          status: string;
          result: string | undefined;
        }) => React.ReactElement;
      },
    ];

    // Simulate what useRenderToolCall actually passes: args + enum status.
    config.render({
      name: "searchDocs",
      toolCallId: "tc-adapt-1",
      args: { query: "copilot" },
      status: "complete", // pretend this is the enum value (string-valued)
      result: "ok",
    } as unknown as Parameters<typeof config.render>[0]);

    expect(customRender).toHaveBeenCalledTimes(1);
    const forwarded = customRender.mock.calls[0][0];
    // Key assertions — user MUST get parameters (not undefined) and a
    // documented string-union status.
    expect(forwarded.parameters).toEqual({ query: "copilot" });
    expect(forwarded.status).toBe("complete");
    expect(forwarded.toolCallId).toBe("tc-adapt-1");
    expect(forwarded.result).toBe("ok");
  });

  // F9: warn-on-unknown-status is deduplicated per distinct value.
  it("warns at most once for the same unknown status across renders", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const customRender = vi.fn((_props: DefaultRenderProps) => (
      <div data-testid="custom">custom</div>
    ));

    const Harness: React.FC = () => {
      useDefaultRenderTool({ render: customRender });
      return null;
    };

    render(<Harness />);

    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        render: (props: {
          name: string;
          toolCallId: string;
          args: unknown;
          status: string;
          result: string | undefined;
        }) => React.ReactElement;
      },
    ];

    // Pick a status string that is NOT in the ToolCallStatus enum. Use a
    // unique sentinel per-test so other tests can't pre-warm the dedup Set.
    const unknownStatus = "react-unknown-status-abc";

    for (let i = 0; i < 3; i++) {
      config.render({
        name: "searchDocs",
        toolCallId: `tc-unknown-${i}`,
        args: {},
        status: unknownStatus as unknown as Parameters<
          typeof config.render
        >[0]["status"],
        result: undefined,
      });
    }

    const matching = warnSpy.mock.calls.filter((call) =>
      String(call[0] ?? "").includes(unknownStatus),
    );
    expect(matching.length).toBe(1);
    warnSpy.mockRestore();
  });

  // Fix #5: circular-ref parameters must not crash the render; safe-stringify logs.
  it("default renderer survives circular-ref parameters and logs", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Build a circular object.
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;

    // The unguarded JSON.stringify in `safeStringifyForAttr` fires during
    // initial render (data-args), and the unguarded `<pre>` JSON.stringify
    // fires after expansion. The fix guards both — neither should throw.
    expect(() =>
      render(
        <DefaultToolCallRenderer
          name="circ"
          toolCallId="tc-circular"
          parameters={circular}
          status="executing"
          result={undefined}
        />,
      ),
    ).not.toThrow();

    // Expand to force the <pre> JSON.stringify path to execute.
    const nameNode = screen.getByTestId("copilot-tool-render-name");
    const headerButton = nameNode.closest("button");
    expect(headerButton).not.toBeNull();
    expect(() => fireEvent.click(headerButton!)).not.toThrow();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
