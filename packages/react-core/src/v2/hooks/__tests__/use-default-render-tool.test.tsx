import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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
    // Note: source DefaultRenderProps omits toolCallId, but the wrapper
    // passes the render through untouched and useRenderTool forwards
    // toolCallId at runtime. This test locks that behavior.
    const customRender = vi.fn(
      (_props: {
        name: string;
        parameters: unknown;
        status: "inProgress" | "executing" | "complete";
        result: string | undefined;
      }) => <div data-testid="custom">custom</div>,
    );

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
          parameters: unknown;
          status: string;
          result: string | undefined;
        }) => React.ReactElement;
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
    // The statically-declared DefaultRenderProps omits toolCallId, but the
    // hook forwards it at runtime — that's what this test locks. Cast
    // through unknown to read the runtime-only field.
    const forwardedProps = customRender.mock.calls[0][0] as unknown as {
      toolCallId: string;
    };
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
      { name: string; render: typeof customRender },
      ReadonlyArray<unknown>,
    ];

    expect(config.name).toBe("*");
    expect(config.render).toBe(customRender);
    expect(forwardedDeps).toBe(deps);
  });

  it("default renderer shows status and expands to show parameters/result", () => {
    const Harness: React.FC = () => {
      useDefaultRenderTool();
      return null;
    };

    render(<Harness />);

    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        render: (props: {
          name: string;
          parameters: unknown;
          status: string;
          result: string | undefined;
        }) => React.ReactElement;
      },
    ];

    const DefaultRenderer = config.render as React.ComponentType<{
      name: string;
      parameters: unknown;
      status: string;
      result: string | undefined;
    }>;

    render(
      <DefaultRenderer
        name="searchDocs"
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
    const Harness: React.FC = () => {
      useDefaultRenderTool();
      return null;
    };

    render(<Harness />);

    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        render: (props: {
          name: string;
          parameters: unknown;
          status: string;
          result: string | undefined;
        }) => React.ReactElement;
      },
    ];

    const DefaultRenderer = config.render as React.ComponentType<{
      name: string;
      parameters: unknown;
      status: string;
      result: string | undefined;
    }>;

    render(
      <DefaultRenderer
        name="searchDocs"
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

  it("default renderer emits stable copilot-tool-render testid and metadata attrs", () => {
    const Harness: React.FC = () => {
      useDefaultRenderTool();
      return null;
    };

    render(<Harness />);

    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        render: (props: {
          name: string;
          parameters: unknown;
          status: string;
          result: string | undefined;
        }) => React.ReactElement;
      },
    ];

    const DefaultRenderer = config.render as React.ComponentType<{
      name: string;
      parameters: unknown;
      status: string;
      result: string | undefined;
    }>;

    render(
      <DefaultRenderer
        name="searchDocs"
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
});
