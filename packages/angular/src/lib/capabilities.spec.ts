import { signal, type Signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import type { AgentCapabilities } from "@ag-ui/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { injectAgentStore, type AgentStore } from "./agent";
import { injectCapabilities } from "./capabilities";
import { provideCopilotChatConfiguration } from "./chat-configuration";

vi.mock("./agent", () => ({
  injectAgentStore: vi.fn(),
}));

const mockInjectAgentStore = vi.mocked(injectAgentStore);

function mockAgentStore(agent: object | undefined) {
  const store = signal({ agent } as AgentStore);
  mockInjectAgentStore.mockReturnValue(store);
  return store;
}

function run(agentId?: string) {
  return TestBed.runInInjectionContext(() => injectCapabilities(agentId));
}

describe("injectCapabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it("returns capabilities when the agent exposes them", () => {
    const capabilities: AgentCapabilities = {
      tools: { supported: true, clientProvided: true },
    };
    mockAgentStore({ capabilities });

    const result = run("my-agent");

    expect(result()).toEqual(capabilities);
    expect(mockInjectAgentStore).toHaveBeenCalledWith("my-agent");
  });

  it("returns undefined when the agent has no capabilities property", () => {
    mockAgentStore({ description: "basic agent" });

    const result = run("basic");

    expect(result()).toBeUndefined();
  });

  it("returns undefined when the agent is undefined", () => {
    mockAgentStore(undefined);

    const result = run();

    expect(result()).toBeUndefined();
  });

  it("returns undefined when capabilities are explicitly undefined", () => {
    mockAgentStore({ capabilities: undefined });

    const result = run();

    expect(result()).toBeUndefined();
  });

  it("uses the chat configuration agent when no agentId is provided", () => {
    TestBed.configureTestingModule({
      providers: [provideCopilotChatConfiguration({ agentId: "chat-agent" })],
    });
    const capabilities: AgentCapabilities = {
      transport: { streaming: true },
    };
    mockAgentStore({ capabilities });

    const result = run();

    expect(result()).toEqual(capabilities);
    const agentIdArg = mockInjectAgentStore.mock.calls[0]![0] as Signal<string>;
    expect(agentIdArg()).toBe("chat-agent");
  });

  it("uses the default agent when no agentId and no chat configuration are provided", () => {
    const capabilities: AgentCapabilities = {
      transport: { streaming: true },
    };
    mockAgentStore({ capabilities });

    const result = run();

    expect(result()).toEqual(capabilities);
    expect(mockInjectAgentStore).toHaveBeenCalledWith("default");
  });
});
