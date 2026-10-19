import React from "react";
import { renderHook } from "@testing-library/react";
import { useCopilotAction } from "../use-copilot-action";
import type { FrontendAction } from "../../types/frontend-action";

describe("useCopilotAction invalid configuration", () => {
  it("names the action and the missing field when a named action has only a render function", () => {
    const action = {
      name: "showWeather",
      render: () => <div>weather</div>,
    } as FrontendAction;

    expect(() => renderHook(() => useCopilotAction(action))).toThrow(
      'useCopilotAction("showWeather"): this action has a render function but no handler. ' +
        "Add a handler to run the action in the browser (an empty one is fine), " +
        'or set available: "disabled" to only render a tool call that the agent runs.',
    );
  });

  it("names the action and the missing fields when a named action has neither handler nor render", () => {
    const action = { name: "doNothing" } as FrontendAction;

    expect(() => renderHook(() => useCopilotAction(action))).toThrow(
      'useCopilotAction("doNothing"): this action has no handler and no render function. ' +
        "Add a handler to run the action in the browser, " +
        'or a render function with available: "disabled" to render a tool call that the agent runs.',
    );
  });
});
