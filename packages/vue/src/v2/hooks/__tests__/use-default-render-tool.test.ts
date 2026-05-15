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
    const deps = ["compact"] as const;

    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool(
          {
            render: customRender,
          },
          deps as unknown as any[],
        );
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    expect(mockUseRenderTool).toHaveBeenCalledTimes(1);
    const [config, forwardedDeps] = mockUseRenderTool.mock.calls[0] as [
      { name: string; render: typeof customRender },
      unknown[],
    ];

    expect(config.name).toBe("*");
    expect(config.render).toBe(customRender);
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
});
