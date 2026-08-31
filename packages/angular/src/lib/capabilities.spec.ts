import { signal } from "@angular/core";
import type { AgentCapabilities } from "@ag-ui/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { injectAgentStore, type AgentStore } from "./agent";
import { injectCapabilities } from "./capabilities";

const { defaultAgentId } = vi.hoisted(() => ({
  defaultAgentId: () => "default",
}));

vi.mock("./agent", () => ({
  injectAgentStore: vi.fn(),
}));
vi.mock("./chat-configuration", () => ({
  injectChatConfiguration: () => ({ agentId: defaultAgentId }),
}));

const mockInjectAgentStore = vi.mocked(injectAgentStore);

function mockAgentStore(agent: object | undefined) {
  const store = signal({ agent } as AgentStore);
  mockInjectAgentStore.mockReturnValue(store);
  return store;
}

describe("injectCapabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns capabilities when the agent exposes them", () => {
    const capabilities: AgentCapabilities = {
      tools: { supported: true, clientProvided: true },
    };
    mockAgentStore({ capabilities });

    const result = injectCapabilities("my-agent");

    expect(result()).toEqual(capabilities);
    expect(mockInjectAgentStore).toHaveBeenCalledWith("my-agent");
  });

  it("returns undefined when the agent has no capabilities property", () => {
    mockAgentStore({ description: "basic agent" });

    const result = injectCapabilities("basic");

    expect(result()).toBeUndefined();
  });

  it("returns undefined when the agent is undefined", () => {
    mockAgentStore(undefined);

    const result = injectCapabilities();

    expect(result()).toBeUndefined();
  });

  it("returns undefined when capabilities are explicitly undefined", () => {
    mockAgentStore({ capabilities: undefined });

    const result = injectCapabilities();

    expect(result()).toBeUndefined();
  });

  it("uses the default agent when no agentId is provided", () => {
    const capabilities: AgentCapabilities = {
      transport: { streaming: true },
    };
    mockAgentStore({ capabilities });

    const result = injectCapabilities();

    expect(result()).toEqual(capabilities);
    expect(mockInjectAgentStore).toHaveBeenCalledWith(defaultAgentId);
  });
});
