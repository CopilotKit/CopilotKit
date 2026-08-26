import type { AbstractAgent } from "@ag-ui/client";
import { describe, expect, it, vi } from "vitest";
import {
  createPredictStateSubscriber,
  getPredictStateUpdate,
} from "../CopilotListeners";

describe("getPredictStateUpdate", () => {
  const mappedConfig = {
    tool: "step_progress_tool",
    state_key: "observed_steps",
    tool_argument: "steps",
  };

  it("maps a tool argument into a differently named state key", () => {
    expect(
      getPredictStateUpdate(mappedConfig, "step_progress_tool", {
        steps: ["one"],
      }),
    ).toEqual({ observed_steps: ["one"] });
  });

  it("emits all tool arguments when tool_argument is omitted", () => {
    expect(
      getPredictStateUpdate(
        {
          tool: "draft_plan",
          state_key: "plan",
        },
        "draft_plan",
        { title: "Launch", tasks: ["Write", "Review"] },
      ),
    ).toEqual({
      plan: { title: "Launch", tasks: ["Write", "Review"] },
    });
  });

  it("maps incrementally parsed string arguments", () => {
    expect(
      getPredictStateUpdate(
        mappedConfig,
        "step_progress_tool",
        '{"steps":["one',
      ),
    ).toEqual({ observed_steps: ["one"] });
  });

  it("waits until the configured argument appears in a partial payload", () => {
    expect(
      getPredictStateUpdate(
        mappedConfig,
        "step_progress_tool",
        '{"status":"working',
      ),
    ).toBeUndefined();
  });

  it("ignores unrelated tool calls", () => {
    expect(
      getPredictStateUpdate(mappedConfig, "get_weather", {
        steps: ["one"],
      }),
    ).toBeUndefined();
  });

  it("applies PredictState configuration through the agent subscriber", () => {
    const setState = vi.fn();
    const predictStateToolsRef = { current: [] } as {
      current: (typeof mappedConfig)[];
    };
    const subscriber = createPredictStateSubscriber(
      { setState } as unknown as AbstractAgent,
      predictStateToolsRef,
    );

    subscriber.onCustomEvent?.({
      event: { name: "PredictState", value: [mappedConfig] },
    } as never);
    subscriber.onToolCallArgsEvent?.({
      toolCallName: "step_progress_tool",
      partialToolCallArgs: { steps: ["one"] },
    } as never);

    expect(setState).toHaveBeenCalledOnce();
    expect(setState).toHaveBeenCalledWith({ observed_steps: ["one"] });
  });
});
