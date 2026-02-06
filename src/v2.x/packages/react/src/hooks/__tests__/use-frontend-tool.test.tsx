import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useFrontendTool } from "../use-frontend-tool";
import { useCopilotKit } from "@/providers/CopilotKitProvider";

vi.mock("@/providers/CopilotKitProvider", () => ({
  useCopilotKit: vi.fn(),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;

describe("useFrontendTool availability", () => {
  const addToolMock = vi.fn();
  const getToolMock = vi.fn();
  const removeToolMock = vi.fn();
  const setRenderToolCallsMock = vi.fn();

  const baseCopilotKit = {
    addTool: addToolMock,
    getTool: getToolMock,
    removeTool: removeToolMock,
    setRenderToolCalls: setRenderToolCallsMock,
    renderToolCalls: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCopilotKit.mockReturnValue({ copilotkit: baseCopilotKit } as any);
    getToolMock.mockReturnValue(undefined);
    baseCopilotKit.renderToolCalls = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not register disabled tools", () => {
    const TestComponent = () => {
      useFrontendTool({
        name: "disabledTool",
        available: "disabled",
        handler: async () => "result",
      });
      return null;
    };

    render(<TestComponent />);

    expect(addToolMock).not.toHaveBeenCalled();
  });

  it("still registers renderer for disabled tools", () => {
    const TestComponent = () => {
      useFrontendTool({
        name: "disabledTool",
        available: "disabled",
        render: () => <div>render</div>,
      });
      return null;
    };

    render(<TestComponent />);

    expect(setRenderToolCallsMock).toHaveBeenCalledTimes(1);
    const renderCalls = setRenderToolCallsMock.mock.calls[0]?.[0];
    expect(Array.isArray(renderCalls)).toBe(true);
    expect(renderCalls).toHaveLength(1);
    expect(renderCalls?.[0]?.name).toBe("disabledTool");
  });
});
