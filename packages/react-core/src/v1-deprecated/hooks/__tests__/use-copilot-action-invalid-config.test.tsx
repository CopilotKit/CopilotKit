import { vi } from "vitest";
import React from "react";
import { render as renderComponent, renderHook } from "@testing-library/react";
import { useCopilotAction } from "../use-copilot-action";
import { useFrontendTool } from "../use-frontend-tool";
import { useRenderToolCall } from "../use-render-tool-call";
import type { FrontendAction } from "../../types/frontend-action";

vi.mock("../use-frontend-tool", () => ({ useFrontendTool: vi.fn() }));
vi.mock("../use-render-tool-call", () => ({ useRenderToolCall: vi.fn() }));
vi.mock("../use-human-in-the-loop", () => ({ useHumanInTheLoop: vi.fn() }));

describe("useCopilotAction configuration", () => {
  beforeEach(() => {
    vi.mocked(useFrontendTool).mockClear();
    vi.mocked(useRenderToolCall).mockClear();
  });

  it("renders the tool calls of a named action that has only a render function", () => {
    const render = () => <div>weather</div>;
    const action = { name: "showWeather", render } as FrontendAction;

    renderHook(() => useCopilotAction(action));

    expect(useRenderToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ name: "showWeather", render }),
      undefined,
    );
    expect(useFrontendTool).not.toHaveBeenCalled();
  });

  it.each([
    ["no handler", { name: "showStatus", render: "Loading status" }],
    [
      'available: "frontend"',
      { name: "showStatus", available: "frontend", render: "Loading status" },
    ],
  ])("wraps a string render in a renderer (%s)", (_label, action) => {
    renderHook(() => useCopilotAction(action as FrontendAction));

    const [{ render }] = vi.mocked(useRenderToolCall).mock.calls[0];
    expect(typeof render).toBe("function");
    const { container } = renderComponent(
      <>{(render as () => React.ReactElement)()}</>,
    );
    expect(container.textContent).toBe("Loading status");
  });

  it("names the action and the missing fields when a named action has neither handler nor render", () => {
    const action = { name: "doNothing" } as FrontendAction;

    expect(() => renderHook(() => useCopilotAction(action))).toThrow(
      'useCopilotAction("doNothing"): this action has no handler and no render function. ' +
        "Add a handler to run the action in the browser, " +
        "or a render function to render a tool call that the agent runs.",
    );
  });
});
