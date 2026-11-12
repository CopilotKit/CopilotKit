import React from "react";
import { renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AgentCapabilities } from "@ag-ui/core";
import { useCapabilities } from "../use-capabilities";
import { useAgent } from "../use-agent";

vi.mock("../use-agent", () => ({
  useAgent: vi.fn(),
}));

const mockUseAgent = useAgent as ReturnType<typeof vi.fn>;

describe("useCapabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns capabilities when agent exposes them", () => {
    const caps: AgentCapabilities = {
      tools: { supported: true, clientProvided: true },
    };

    mockUseAgent.mockReturnValue({
      agent: { capabilities: caps },
    });

    const { result } = renderHook(() => useCapabilities("my-agent"));

    expect(result.current).toEqual(caps);
    expect(mockUseAgent).toHaveBeenCalledWith({ agentId: "my-agent" });
  });

  it("returns undefined when agent has no capabilities property", () => {
    mockUseAgent.mockReturnValue({
      agent: { description: "basic agent" },
    });

    const { result } = renderHook(() => useCapabilities("basic"));

    expect(result.current).toBeUndefined();
  });

  it("returns undefined when agent is undefined (not connected yet)", () => {
    mockUseAgent.mockReturnValue({ agent: undefined });

    const { result } = renderHook(() => useCapabilities());

    expect(result.current).toBeUndefined();
  });

  it("returns undefined when capabilities property is explicitly undefined", () => {
    mockUseAgent.mockReturnValue({
      agent: { capabilities: undefined },
    });

    const { result } = renderHook(() => useCapabilities());

    expect(result.current).toBeUndefined();
  });

  it("uses default agent when no agentId is provided", () => {
    const caps: AgentCapabilities = {
      transport: { streaming: true },
    };

    mockUseAgent.mockReturnValue({
      agent: { capabilities: caps },
    });

    const { result } = renderHook(() => useCapabilities());

    expect(result.current).toEqual(caps);
    expect(mockUseAgent).toHaveBeenCalledWith({ agentId: undefined });
  });
});
