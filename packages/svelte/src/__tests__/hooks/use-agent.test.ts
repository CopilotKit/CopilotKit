import type { AbstractAgent } from "@ag-ui/client";
import type { Message } from "@ag-ui/core";
import type { SubscribeToAgentSubscriber } from "@copilotkit/core";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import { render, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { CopilotKitCoreSvelte } from "../../lib/svelte-core";
import type { CopilotKitContextValue } from "../../providers/context";
import { globalThreadCloneMap } from "../../hooks/create-agent.svelte";
import CreateAgentStateHarness from "./create-agent-state-harness.svelte";
import ThreadCloneEvictionHarness from "./thread-clone-eviction-harness.svelte";

class TestAgent {
  agentId = "test-agent";
  state: Record<string, unknown> = { status: "idle" };
  messages: Message[] = [];
  isRunning = false;
}

describe("createAgent state updates", () => {
  it("invalidates consumers when the same agent instance changes state", async () => {
    const agent = new TestAgent() as unknown as AbstractAgent;
    let handlers: SubscribeToAgentSubscriber | undefined;
    const unsubscribe = vi.fn();

    const core = {
      agents: { "test-agent": agent },
      runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
      runtimeUrl: undefined,
      runtimeTransport: "auto",
      headers: {},
      getAgent: vi.fn(() => agent),
      subscribeToAgentWithOptions: vi.fn(
        (_agent: AbstractAgent, nextHandlers: SubscribeToAgentSubscriber) => {
          handlers = nextHandlers;
          return { unsubscribe };
        },
      ),
    } as unknown as CopilotKitCoreSvelte;

    const context = {
      copilotkit: core,
      executingToolCallIds: new Set<string>(),
      agents: core.agents,
      runtimeConnectionStatus: core.runtimeConnectionStatus,
      runtimeUrl: core.runtimeUrl,
      runtimeTransport: core.runtimeTransport,
      headers: core.headers,
      threadEndpoints: undefined,
      intelligence: undefined,
      licenseStatus: undefined,
    } as CopilotKitContextValue;

    const view = render(CreateAgentStateHarness, { props: { context } });

    await waitFor(() => {
      expect(view.getByTestId("agent-state").textContent).toBe(
        '{"status":"idle"}',
      );
      expect(handlers?.onStateChanged).toBeTypeOf("function");
    });

    (agent as unknown as TestAgent).state = { status: "streaming" };
    handlers?.onStateChanged?.({ agent } as never);

    await waitFor(() => {
      expect(view.getByTestId("agent-state").textContent).toBe(
        '{"status":"streaming"}',
      );
    });

    view.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("evicts the oldest thread clone after the per-agent limit is reached", async () => {
    const clones: TestAgent[] = [];
    const source = new TestAgent() as TestAgent & {
      clone: () => TestAgent;
      setMessages: (messages: Message[]) => void;
      setState: (state: Record<string, unknown>) => void;
      subscribe: () => { unsubscribe: () => void };
      threadId?: string;
    };
    source.clone = () => {
      const clone = new TestAgent() as typeof source;
      clone.setMessages = (messages) => {
        clone.messages = messages;
      };
      clone.setState = (state) => {
        clone.state = state;
      };
      clone.subscribe = () => ({ unsubscribe() {} });
      clones.push(clone);
      return clone;
    };
    source.setMessages = () => {};
    source.setState = () => {};
    source.subscribe = () => ({ unsubscribe() {} });

    const core = {
      agents: { default: source },
      runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
      runtimeUrl: undefined,
      runtimeTransport: "auto",
      headers: {},
      getAgent: vi.fn(() => source),
      subscribeToAgentWithOptions: vi.fn(() => ({ unsubscribe: vi.fn() })),
    } as unknown as CopilotKitCoreSvelte;
    const context = {
      copilotkit: core,
      executingToolCallIds: new Set<string>(),
      agents: core.agents,
      runtimeConnectionStatus: core.runtimeConnectionStatus,
      runtimeUrl: core.runtimeUrl,
      runtimeTransport: core.runtimeTransport,
      headers: core.headers,
      threadEndpoints: undefined,
      intelligence: undefined,
      licenseStatus: undefined,
    } as CopilotKitContextValue;
    const view = render(ThreadCloneEvictionHarness, {
      props: { context, threadId: "thread-0" },
    });

    for (let index = 1; index <= 50; index += 1) {
      await view.rerender({ context, threadId: `thread-${index}` });
    }

    await waitFor(() => {
      const byThread = globalThreadCloneMap.get(
        source as unknown as AbstractAgent,
      );
      expect(byThread?.size).toBe(50);
      expect(byThread?.has("thread-0")).toBe(false);
      expect(byThread?.has("thread-50")).toBe(true);
    });
    expect(clones).toHaveLength(51);
  });
});
