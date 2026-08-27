// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCloudPlotAgent } from "./useCloudPlotAgent";

const mocks = vi.hoisted(() => ({
  agent: {
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
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgent: () => ({ agent: mocks.agent }),
}));

describe("useCloudPlotAgent", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("returns an agent execution failure to the submitting caller", async () => {
    const failure = new Error("CloudPlot agent unavailable");
    mocks.agent.runAgent.mockRejectedValue(failure);
    const { result } = renderHook(() => useCloudPlotAgent());

    let execution: unknown;
    act(() => {
      execution = result.current.appendMessage("Design a secure VPC");
    });

    await expect(execution).rejects.toBe(failure);
    expect(mocks.agent.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "user",
        content: "Design a secure VPC",
      }),
    );
  });
});
