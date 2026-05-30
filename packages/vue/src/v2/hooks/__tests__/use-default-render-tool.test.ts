import { fireEvent, render, screen } from "@testing-library/vue";
import { defineComponent } from "vue";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDefaultRenderTool } from "../use-default-render-tool";
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
    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool();
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    expect(mockUseRenderTool).toHaveBeenCalledTimes(1);
    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        name: string;
        render: (props: {
          name: string;
          toolCallId: string;
          parameters: unknown;
          status: string;
          result: string | undefined;
        }) => unknown;
      },
    ];

    expect(config.name).toBe("*");
    expect(typeof config.render).toBe("function");
  });

  it("forwards custom render function and deps", () => {
    const customRender = vi.fn(() => "custom");
    const deps = [() => "compact"];

    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool(
          {
            render: customRender,
          },
          deps,
        );
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

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
        }) => unknown;
      },
      unknown[],
    ];

    expect(config.name).toBe("*");
    // The registered render is a wrapper that adapts RawRendererProps →
    // DefaultRenderProps before invoking the user's render, so the user
    // function is not the registered render by reference. Verify the
    // wrapper forwards correctly instead.
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

  it("forwards toolCallId to custom wildcard render function", () => {
    const customRender = vi.fn(() => "custom");

    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool({ render: customRender });
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        name: string;
        render: (props: {
          name: string;
          toolCallId: string;
          parameters: unknown;
          status: "inProgress" | "executing" | "complete";
          result: string | undefined;
        }) => unknown;
      },
    ];

    config.render({
      name: "searchDocs",
      toolCallId: "tc-forwarded-1",
      parameters: { query: "copilot" },
      status: "executing",
      result: undefined,
    });

    expect(customRender).toHaveBeenCalledTimes(1);
    expect(customRender.mock.calls[0]?.[0]).toMatchObject({
      toolCallId: "tc-forwarded-1",
    });
  });

  it("forwards custom render component", () => {
    const customRender = defineComponent({
      props: {
        name: { type: String, required: true },
      },
      template: `<div>{{ name }}</div>`,
    });

    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool({
          render: customRender,
        });
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const [config] = mockUseRenderTool.mock.calls[0] as [
      { name: string; render: typeof customRender },
    ];

    expect(config.name).toBe("*");
    expect(config.render).toBe(customRender);
  });

  it("default renderer shows status and expands to show parameters/result", async () => {
    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool();
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        render: unknown;
      },
    ];

    const DefaultRenderer = config.render;
    render(DefaultRenderer as any, {
      props: {
        name: "searchDocs",
        toolCallId: "tc-default-executing",
        parameters: { query: "copilot" },
        status: "executing",
        result: undefined,
      },
    });

    expect(screen.getByText("searchDocs")).toBeDefined();
    expect(screen.getByText("Running")).toBeDefined();

    await fireEvent.click(screen.getByText("searchDocs"));
    expect(screen.getByText("Arguments")).toBeDefined();
    expect(screen.getByText(/copilot/)).toBeDefined();
  });

  it("default renderer shows done status and result payload", async () => {
    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool();
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        render: unknown;
      },
    ];

    const DefaultRenderer = config.render;
    render(DefaultRenderer as any, {
      props: {
        name: "searchDocs",
        toolCallId: "tc-default-complete",
        parameters: { query: "copilot" },
        status: "complete",
        result: "done",
      },
    });

    expect(screen.getByText("Done")).toBeDefined();
    await fireEvent.click(screen.getByText("searchDocs"));
    expect(screen.getByText("Result")).toBeDefined();
    expect(screen.getByText("done")).toBeDefined();
  });

  it("default renderer emits stable copilot-tool-render testid and metadata attrs", () => {
    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool();
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        render: unknown;
      },
    ];

    const DefaultRenderer = config.render;
    render(DefaultRenderer as any, {
      props: {
        name: "searchDocs",
        toolCallId: "tc-testid-1",
        parameters: { query: "copilot" },
        status: "complete",
        result: "ok",
      },
    });

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

  // Fix #1: a11y — vue version already uses <button>; assert aria-expanded toggles.
  it("default renderer header is a button with aria-expanded that toggles", async () => {
    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool();
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        render: unknown;
      },
    ];

    const DefaultRenderer = config.render;
    render(DefaultRenderer as any, {
      props: {
        name: "searchDocs",
        toolCallId: "tc-a11y",
        parameters: { query: "copilot" },
        status: "executing",
        result: undefined,
      },
    });

    const nameNode = screen.getByTestId("copilot-tool-render-name");
    const headerButton = nameNode.closest("button");
    expect(headerButton).not.toBeNull();
    expect(headerButton!.getAttribute("type")).toBe("button");
    expect(headerButton!.getAttribute("aria-expanded")).toBe("false");

    await fireEvent.click(headerButton!);
    expect(headerButton!.getAttribute("aria-expanded")).toBe("true");
  });

  // Fix #3: data-tool-call-id is emitted on the vue wrapper too.
  it("default renderer emits data-tool-call-id on the wrapper element", () => {
    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool();
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        render: unknown;
      },
    ];

    const DefaultRenderer = config.render;
    render(DefaultRenderer as any, {
      props: {
        name: "searchDocs",
        toolCallId: "tc-id-emit",
        parameters: { query: "copilot" },
        status: "complete",
        result: "ok",
      },
    });

    const wrapper = screen.getByTestId("copilot-tool-render");
    expect(wrapper.getAttribute("data-tool-call-id")).toBe("tc-id-emit");
  });

  // Fix #4: opt-in config.render receives adapted DefaultRenderProps shape
  // (parameters, string-union status) — not the raw renderer signature.
  it("opt-in config.render receives parameters (not args) and string-union status", () => {
    const customRender = vi.fn(() => "custom");

    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool({ render: customRender });
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        name: string;
        render: (props: {
          name: string;
          toolCallId: string;
          args: unknown;
          status: string;
          result: string | undefined;
        }) => unknown;
      },
    ];

    // Simulate what CopilotChatToolCallsView actually passes:
    // { name, toolCallId, args, status: ToolCallStatus, result }
    config.render({
      name: "searchDocs",
      toolCallId: "tc-adapt-1",
      args: { query: "copilot" },
      status: "complete",
      result: "ok",
    });

    expect(customRender).toHaveBeenCalledTimes(1);
    const forwarded = customRender.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(forwarded.parameters).toEqual({ query: "copilot" });
    expect(forwarded.status).toBe("complete");
    expect(forwarded.toolCallId).toBe("tc-adapt-1");
    expect(forwarded.result).toBe("ok");
  });

  // Fix #5: circular-ref parameters must not crash the vue render; log.
  it("default renderer survives circular-ref parameters and logs", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool();
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        render: unknown;
      },
    ];

    const DefaultRenderer = config.render;

    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;

    expect(() =>
      render(DefaultRenderer as any, {
        props: {
          name: "circ",
          toolCallId: "tc-circular",
          parameters: circular,
          status: "executing",
          result: undefined,
        },
      }),
    ).not.toThrow();

    const headerButton = screen
      .getByTestId("copilot-tool-render-name")
      .closest("button");
    if (headerButton) {
      await expect(fireEvent.click(headerButton)).resolves.not.toThrow();
    }

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
