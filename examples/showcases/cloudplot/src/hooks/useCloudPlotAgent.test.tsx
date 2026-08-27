// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCloudPlotAgent } from "./useCloudPlotAgent";

const mocks = vi.hoisted(() => ({
  provisionalAgent: {
    state: null as unknown,
    setState: vi.fn(),
    addMessage: vi.fn(),
    runAgent: vi.fn(),
  },
  readyAgent: {
    state: {
      nodes: [],
      edges: [],
      logs: [],
      cost: 0,
      status: "idle",
      validation_errors: [],
    },
    setState: vi.fn(),
    addMessage: vi.fn(),
    runAgent: vi.fn(),
  },
  currentAgent: null as unknown as {
    state: unknown;
    setState: ReturnType<typeof vi.fn>;
    addMessage: ReturnType<typeof vi.fn>;
    runAgent: ReturnType<typeof vi.fn>;
  },
  isReady: true,
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgent: () => ({ agent: mocks.currentAgent, isReady: mocks.isReady }),
}));

describe("useCloudPlotAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readyAgent.state = {
      nodes: [],
      edges: [],
      logs: [],
      cost: 0,
      status: "idle",
      validation_errors: [],
    };
    mocks.currentAgent = mocks.readyAgent;
    mocks.isReady = true;
  });
  afterEach(cleanup);

  it("returns an agent execution failure to the submitting caller", async () => {
    const failure = new Error("CloudPlot agent unavailable");
    mocks.readyAgent.runAgent.mockRejectedValue(failure);
    const { result } = renderHook(() => useCloudPlotAgent());

    let execution: unknown;
    act(() => {
      execution = result.current.appendMessage("Design a secure VPC");
    });

    await expect(execution).rejects.toBe(failure);
    expect(mocks.readyAgent.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "user",
        content: "Design a secure VPC",
      }),
    );
  });

  it("initializes only the real agent after a provisional agent is replaced", () => {
    mocks.currentAgent = mocks.provisionalAgent;
    mocks.isReady = false;
    const { result, rerender } = renderHook(() => useCloudPlotAgent());

    expect(result.current.isReady).toBe(false);
    expect(mocks.provisionalAgent.setState).not.toHaveBeenCalled();

    mocks.readyAgent.state = {} as typeof mocks.readyAgent.state;
    mocks.currentAgent = mocks.readyAgent;
    mocks.isReady = true;
    rerender();

    expect(result.current.isReady).toBe(true);
    expect(mocks.readyAgent.setState).toHaveBeenCalledWith(
      expect.objectContaining({ nodes: [], edges: [] }),
    );
  });

  it("rejects quick-start submission while the agent is provisional", async () => {
    mocks.currentAgent = mocks.provisionalAgent;
    mocks.isReady = false;
    const { result } = renderHook(() => useCloudPlotAgent());

    await expect(result.current.appendMessage("Design a VPC")).rejects.toThrow(
      "CloudPlot agent is not ready",
    );
    expect(mocks.provisionalAgent.addMessage).not.toHaveBeenCalled();
  });
});
