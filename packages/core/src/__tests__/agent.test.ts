import type { AgentSubscriber } from "@ag-ui/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProxiedCopilotRuntimeAgent } from "../agent";

function createAgent(compactRestore = true): ProxiedCopilotRuntimeAgent {
  return new ProxiedCopilotRuntimeAgent({
    runtimeUrl: "https://runtime.example",
    agentId: "default",
    compactRestore,
  });
}

describe("ProxiedCopilotRuntimeAgent compact restore mutation warning", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    "onEvent",
    "onToolCallStartEvent",
    "onRunInitialized",
    "onRunFailed",
    "onRunFinalized",
  ] as const)("warns for the mutation-capable %s callback", (callbackName) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const agent = createAgent();

    agent.subscribe({
      [callbackName]: () => ({ state: { replaced: true } }),
    } as AgentSubscriber);

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/compact restore/i);
    expect(warn.mock.calls[0]?.[0]).toMatch(/immutable/i);
    expect(warn.mock.calls[0]?.[0]).toContain("compactRestore: false");
  });

  it("warns only once per public agent", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const agent = createAgent();

    agent.subscribe({ onEvent: () => ({ state: {} }) });
    agent.subscribe({ onStateDeltaEvent: () => ({ state: {} }) });

    expect(warn).toHaveBeenCalledOnce();
  });

  it("does not warn for notification-only callbacks", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const agent = createAgent();

    agent.subscribe({
      onMessagesChanged: () => {},
      onStateChanged: () => {},
      onNewMessage: () => {},
      onNewToolCall: () => {},
    });

    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn outside development", () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    createAgent().subscribe({ onEvent: () => ({ state: {} }) });

    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn when compact restore is disabled", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    createAgent(false).subscribe({ onEvent: () => ({ state: {} }) });

    expect(warn).not.toHaveBeenCalled();
  });

  it("preserves the base subscription and unsubscription behavior", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const agent = createAgent();
    const subscriber: AgentSubscriber = {
      onEvent: () => ({ state: {} }),
    };

    const subscription = agent.subscribe(subscriber);
    expect(agent.subscribers).toContain(subscriber);

    subscription.unsubscribe();
    expect(agent.subscribers).not.toContain(subscriber);
  });

  it("warns independently for a cloned public agent without forwarding a duplicate", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const agent = createAgent();
    const clone = agent.clone();

    agent.subscribe({ onEvent: () => ({ state: {} }) });
    clone.subscribe({ onEvent: () => ({ state: {} }) });
    clone.subscribe({ onRawEvent: () => ({ state: {} }) });

    expect(warn).toHaveBeenCalledTimes(2);
  });
});
