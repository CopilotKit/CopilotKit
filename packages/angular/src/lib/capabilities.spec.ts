import type { AgentCapabilities } from "@ag-ui/core";
import type { Signal } from "@angular/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStore } from "./agent";
import { injectCapabilities } from "./capabilities";

const { defaultAgentId, mockInjectAgentStore } = vi.hoisted(() => ({
  defaultAgentId: () => "default",
  mockInjectAgentStore: vi.fn(),
}));

vi.mock("./agent", () => ({
  injectAgentStore: mockInjectAgentStore,
}));
vi.mock("./chat-configuration", () => ({
  injectChatConfiguration: () => ({ agentId: defaultAgentId }),
}));

function mockAgentStore(agent: object | undefined) {
  // A plain function, not Angular signal(). This spec has no TestBed, and
  // injectCapabilities only needs a callable store that returns `{ agent }`.
  const store = (() => ({ agent })) as Signal<AgentStore>;
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
