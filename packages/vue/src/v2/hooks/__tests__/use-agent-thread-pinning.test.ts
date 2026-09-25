import { defineComponent, ref, shallowRef, toRaw } from "vue";
import { render, cleanup } from "@testing-library/vue";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AbstractAgent } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import { Observable } from "rxjs";
import { useCopilotKit } from "../../providers/useCopilotKit";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { useAgent } from "../use-agent";

vi.mock("../../providers/useCopilotKit", () => ({
  useCopilotKit: vi.fn(),
}));
vi.mock("../../providers/useCopilotChatConfiguration", () => ({
  useCopilotChatConfiguration: vi.fn(),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;
const mockUseChatConfig = useCopilotChatConfiguration as ReturnType<
  typeof vi.fn
>;

class SimpleAgent extends AbstractAgent {
  run(): Observable<BaseEvent> {
    return new Observable();
  }
}

/**
 * Replaces `use-agent-thread-isolation.test.ts`, which pinned the per-thread
 * *cloning* `useAgent` used to do. Cloning is gone; the hook mirrors React:
 * one shared instance per agentId with the chat configuration's thread pinned
 * onto it (gated on `hasExplicitThreadId`), or — with the all-or-nothing
 * `{ agentId, runtimeAgentId, threadId }` set — a private proxied agent.
 *
 * The invariant under test: never a copy, and a caller-chosen thread lands on
 * the agent while an auto-minted placeholder does not.
 */
describe("useAgent agent resolution", () => {
  let registryAgent: SimpleAgent;
  let copilotkitRef: ReturnType<typeof shallowRef>;

  beforeEach(() => {
    registryAgent = new SimpleAgent();
    registryAgent.agentId = "my-agent";
    // `shallowRef`, matching production (`CopilotKitProvider.vue` provides
    // `shallowRef<CopilotKitCoreVue>`). A deep `ref` would hand the hook
    // reactive proxies of the core and of every agent, so the identity
    // assertions below would compare proxies rather than the real instances.
    copilotkitRef = shallowRef({
      getAgent: vi.fn((id: string) =>
        id === "my-agent" ? registryAgent : undefined,
      ),
      runtimeUrl: "http://localhost:3000/api/copilotkit",
      runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
      runtimeTransport: "rest",
      headers: {},
      agents: { "my-agent": registryAgent },
      defaultThrottleMs: undefined,
      subscribeToAgentWithOptions: vi.fn(() => ({ unsubscribe: vi.fn() })),
    });
    mockUseCopilotKit.mockReturnValue({
      copilotkit: copilotkitRef,
      executingToolCallIds: ref(new Set()),
    });
    mockUseChatConfig.mockReturnValue(ref(null));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const mountProbe = () => {
    let captured: AbstractAgent | null = null;
    const Probe = defineComponent({
      setup() {
        captured = useAgent({ agentId: "my-agent" }).agent.value;
        return () => null;
      },
    });
    render(Probe);
    return () => captured;
  };

  it("returns the registry instance itself, never a copy", () => {
    const captured = mountProbe();
    expect(toRaw(captured()!)).toBe(registryAgent);
  });

  it("returns the same instance to two hooks sharing an agentId", () => {
    let first: AbstractAgent | null = null;
    let second: AbstractAgent | null = null;
    const Probe = defineComponent({
      setup() {
        first = useAgent({ agentId: "my-agent" }).agent.value;
        second = useAgent({ agentId: "my-agent" }).agent.value;
        return () => null;
      },
    });

    render(Probe);

    // Cloning used to make these two different objects keyed by thread.
    expect(toRaw(first!)).toBe(toRaw(second!));
    expect(toRaw(first!)).toBe(registryAgent);
  });

  it("pins the chat configuration's thread when the caller chose it", () => {
    mockUseChatConfig.mockReturnValue(
      ref({
        agentId: "my-agent",
        threadId: "chosen-thread",
        hasExplicitThreadId: true,
      }),
    );

    mountProbe();

    expect(registryAgent.threadId).toBe("chosen-thread");
  });

  it("leaves the agent's own thread alone for a non-explicit placeholder", () => {
    // A ThreadsProvider-minted UUID is as meaningless to the backend as the
    // agent's own, so it must not overwrite it.
    const ownThreadId = registryAgent.threadId;
    mockUseChatConfig.mockReturnValue(
      ref({
        agentId: "my-agent",
        threadId: "placeholder-thread",
        hasExplicitThreadId: false,
      }),
    );

    mountProbe();

    expect(registryAgent.threadId).toBe(ownThreadId);
    expect(registryAgent.threadId).not.toBe("placeholder-thread");
  });

  describe("all-or-nothing thread scoping (mirrors React)", () => {
    const expectSetupThrow = (setup: () => void, message: RegExp) => {
      const Probe = defineComponent({
        setup() {
          setup();
          return () => null;
        },
      });
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(() => render(Probe)).toThrow(message);
      } finally {
        spy.mockRestore();
      }
    };

    it("throws when threadId is passed without runtimeAgentId", () => {
      expectSetupThrow(() => {
        // @ts-expect-error threadId requires runtimeAgentId
        useAgent({ agentId: "my-agent", threadId: "t1" });
      }, /`threadId` requires `runtimeAgentId`/);
    });

    it("throws when runtimeAgentId is passed without threadId", () => {
      expectSetupThrow(() => {
        // @ts-expect-error runtimeAgentId requires threadId
        useAgent({ agentId: "chat-1", runtimeAgentId: "my-agent" });
      }, /`runtimeAgentId` requires `threadId`/);
    });

    it("throws when runtimeAgentId is passed without an explicit agentId", () => {
      expectSetupThrow(() => {
        // @ts-expect-error runtimeAgentId requires an explicit agentId
        useAgent({ runtimeAgentId: "my-agent", threadId: "t1" });
      }, /requires an explicit `agentId`/);
    });
  });
});
