import { defineComponent, nextTick, ref, toRaw, watchEffect } from "vue";
import { render, cleanup } from "@testing-library/vue";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AbstractAgent, type BaseEvent } from "@ag-ui/client";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import { Observable } from "rxjs";
import { useCopilotKit } from "../../providers/useCopilotKit";
import { useAgent } from "../use-agent";

vi.mock("../../providers/useCopilotKit", () => ({
  useCopilotKit: vi.fn(),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;

class CloneableAgent extends AbstractAgent {
  clone(): CloneableAgent {
    const cloned = new CloneableAgent();
    cloned.agentId = this.agentId;
    cloned.setMessages([...this.messages]);
    return cloned;
  }

  run(): Observable<BaseEvent> {
    return new Observable();
  }
}

describe("useAgent thread isolation", () => {
  let mockCopilotkit: {
    getAgent: ReturnType<typeof vi.fn>;
    runtimeUrl: string | undefined;
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus;
    runtimeTransport: string;
    headers: Record<string, string>;
    agents: Record<string, AbstractAgent>;
    // Added after the hook moved to consume the shared core API. Mocks only
    // need a no-op subscription object here; notification behavior is covered
    // in `use-agent-throttle.test.ts`.
    subscribeToAgentWithOptions: ReturnType<typeof vi.fn>;
  };
  let copilotkitRef: ReturnType<typeof ref<typeof mockCopilotkit>>;
  let registeredAgent: CloneableAgent;

  beforeEach(() => {
    registeredAgent = new CloneableAgent();
    registeredAgent.agentId = "my-agent";
    mockCopilotkit = {
      getAgent: vi.fn((id: string) =>
        id === "my-agent" ? registeredAgent : undefined,
      ),
      runtimeUrl: "http://localhost:3000/api/copilotkit",
      runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
      runtimeTransport: "rest",
      headers: {},
      agents: { "my-agent": registeredAgent },
      subscribeToAgentWithOptions: vi.fn(() => ({ unsubscribe: vi.fn() })),
    };
    copilotkitRef = ref(mockCopilotkit);
    mockUseCopilotKit.mockReturnValue({
      copilotkit: copilotkitRef,
      executingToolCallIds: ref(new Set()),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("returns different agent instances for different threadIds with the same agentId", async () => {
    const agents: Record<string, AbstractAgent> = {};

    const TrackerA = defineComponent({
      setup(props) {
        const { agent } = useAgent({
          agentId: "my-agent",
          threadId: "thread-a",
        });
        watchEffect(() => {
          agents.a = agent.value;
        });
        return {};
      },
      template: "<div />",
    });

    const TrackerB = defineComponent({
      setup(props) {
        const { agent } = useAgent({
          agentId: "my-agent",
          threadId: "thread-b",
        });
        watchEffect(() => {
          agents.b = agent.value;
        });
        return {};
      },
      template: "<div />",
    });

    const Host = defineComponent({
      components: { TrackerA, TrackerB },
      template: "<div><TrackerA /><TrackerB /></div>",
    });

    render(Host);
    await nextTick();

    expect(agents.a).toBeDefined();
    expect(agents.b).toBeDefined();
    expect(agents.a).not.toBe(agents.b);
  });

  it("returns the same cached instance for the same (agentId, threadId) across re-renders", async () => {
    const instances: AbstractAgent[] = [];

    const Tracker = defineComponent({
      props: {
        tick: { type: Number, required: true },
      },
      setup(props) {
        const { agent } = useAgent({
          agentId: "my-agent",
          threadId: "thread-x",
        });
        watchEffect(() => {
          const currentTick = props.tick;
          void currentTick;
          instances.push(agent.value);
        });
        return {};
      },
      template: "<div>{{ tick }}</div>",
    });

    const { rerender } = render(Tracker, {
      props: { tick: 0 },
    });
    await nextTick();
    await rerender({ tick: 1 });
    await nextTick();

    expect(instances.length).toBe(2);
    expect(toRaw(instances[0]!)).toBe(toRaw(instances[1]!));
  });

  it("returns the shared registry agent when no threadId is provided (backward compat)", async () => {
    const captured = ref<AbstractAgent | undefined>();
    const Tracker = defineComponent({
      setup() {
        const { agent } = useAgent({ agentId: "my-agent" });
        watchEffect(() => {
          captured.value = agent.value;
        });
        return {};
      },
      template: "<div />",
    });

    render(Tracker);
    await nextTick();
    expect(toRaw(captured.value!)).toBe(registeredAgent);
  });

  it("isolates messages between thread-specific agents", async () => {
    registeredAgent.addMessage({
      id: "source-msg",
      role: "user",
      content: "pre-existing on source",
    });

    const agents: Record<string, AbstractAgent> = {};
    const TrackerA = defineComponent({
      setup() {
        const { agent } = useAgent({
          agentId: "my-agent",
          threadId: "thread-a",
        });
        watchEffect(() => {
          agents.a = agent.value;
        });
        return {};
      },
      template: "<div />",
    });
    const TrackerB = defineComponent({
      setup() {
        const { agent } = useAgent({
          agentId: "my-agent",
          threadId: "thread-b",
        });
        watchEffect(() => {
          agents.b = agent.value;
        });
        return {};
      },
      template: "<div />",
    });
    const Host = defineComponent({
      components: { TrackerA, TrackerB },
      template: "<div><TrackerA /><TrackerB /></div>",
    });

    render(Host);
    await nextTick();

    expect(agents.a.messages).toHaveLength(0);
    expect(agents.b.messages).toHaveLength(0);

    agents.a.addMessage({
      id: "msg-1",
      role: "user",
      content: "hello from thread A",
    });

    expect(agents.a.messages).toHaveLength(1);
    expect(agents.b.messages).toHaveLength(0);
  });

  it("sets threadId on cloned agents", async () => {
    const agents: Record<string, AbstractAgent> = {};
    const TrackerA = defineComponent({
      setup() {
        const { agent } = useAgent({
          agentId: "my-agent",
          threadId: "thread-a",
        });
        watchEffect(() => {
          agents.a = agent.value;
        });
        return {};
      },
      template: "<div />",
    });
    const TrackerB = defineComponent({
      setup() {
        const { agent } = useAgent({
          agentId: "my-agent",
          threadId: "thread-b",
        });
        watchEffect(() => {
          agents.b = agent.value;
        });
        return {};
      },
      template: "<div />",
    });
    const Host = defineComponent({
      components: { TrackerA, TrackerB },
      template: "<div><TrackerA /><TrackerB /></div>",
    });

    render(Host);
    await nextTick();

    expect(agents.a.threadId).toBe("thread-a");
    expect(agents.b.threadId).toBe("thread-b");
  });

  it("invalidates stale clone when the registry agent is replaced", async () => {
    const capturedAgent = ref<AbstractAgent | undefined>();

    const Tracker = defineComponent({
      props: {
        tid: { type: String, required: true },
        tick: { type: Number, required: true },
      },
      setup(props) {
        const { agent } = useAgent({
          agentId: "my-agent",
          threadId: () => props.tid,
        });
        watchEffect(() => {
          capturedAgent.value = agent.value;
        });
        return {};
      },
      template: "<div>{{ tick }}</div>",
    });

    const { rerender } = render(Tracker, {
      props: { tid: "thread-a", tick: 0 },
    });
    await nextTick();
    const firstClone = capturedAgent.value;
    expect(firstClone).not.toBe(registeredAgent);

    const replacementAgent = new CloneableAgent();
    replacementAgent.agentId = "my-agent";

    copilotkitRef.value.agents = { "my-agent": replacementAgent };
    copilotkitRef.value.getAgent = vi.fn((id: string) =>
      id === "my-agent" ? replacementAgent : undefined,
    );

    await rerender({ tid: "thread-a", tick: 1 });
    await nextTick();

    const secondClone = capturedAgent.value;
    expect(secondClone).not.toBe(firstClone);
    expect(secondClone).not.toBe(replacementAgent);
  });

  it("switching threadId returns a fresh clone; switching back returns the cached one", async () => {
    const capturedAgent = ref<AbstractAgent | undefined>();

    const Tracker = defineComponent({
      props: {
        tid: { type: String, required: true },
      },
      setup(props) {
        const { agent } = useAgent({
          agentId: "my-agent",
          threadId: () => props.tid,
        });
        watchEffect(() => {
          capturedAgent.value = agent.value;
        });
        return {};
      },
      template: "<div />",
    });

    const { rerender } = render(Tracker, {
      props: { tid: "thread-a" },
    });
    await nextTick();
    const cloneA = capturedAgent.value;

    await rerender({ tid: "thread-b" });
    await nextTick();
    const cloneB = capturedAgent.value;
    expect(cloneB).not.toBe(cloneA);

    await rerender({ tid: "thread-a" });
    await nextTick();
    expect(capturedAgent.value).toBe(cloneA);
  });

  it("uses a fresh clone with correct threadId when provisional transitions to real agent", async () => {
    copilotkitRef.value.runtimeConnectionStatus =
      CopilotKitCoreRuntimeConnectionStatus.Disconnected;
    copilotkitRef.value.getAgent = vi.fn(() => undefined);
    copilotkitRef.value.agents = {};

    const capturedAgent = ref<AbstractAgent | undefined>();
    const Tracker = defineComponent({
      props: {
        tick: { type: Number, required: true },
      },
      setup() {
        const { agent } = useAgent({
          agentId: "my-agent",
          threadId: "thread-a",
        });
        watchEffect(() => {
          capturedAgent.value = agent.value;
        });
        return {};
      },
      template: "<div>{{ tick }}</div>",
    });

    const { rerender } = render(Tracker, {
      props: { tick: 0 },
    });
    await nextTick();
    const provisional = capturedAgent.value!;
    expect(provisional.threadId).toBe("thread-a");

    copilotkitRef.value.runtimeConnectionStatus =
      CopilotKitCoreRuntimeConnectionStatus.Connected;
    copilotkitRef.value.getAgent = vi.fn((id: string) =>
      id === "my-agent" ? registeredAgent : undefined,
    );
    copilotkitRef.value.agents = { "my-agent": registeredAgent };

    await rerender({ tick: 1 });
    await nextTick();

    const realClone = capturedAgent.value!;
    expect(realClone).not.toBe(provisional);
    expect(realClone).not.toBe(registeredAgent);
    expect(realClone.threadId).toBe("thread-a");
  });

  it("uses composite key for provisional agents when threadId is provided", async () => {
    copilotkitRef.value.runtimeConnectionStatus =
      CopilotKitCoreRuntimeConnectionStatus.Disconnected;
    copilotkitRef.value.getAgent = vi.fn(() => undefined);
    copilotkitRef.value.agents = {};

    const agents: Record<string, AbstractAgent> = {};
    const TrackerA = defineComponent({
      setup() {
        const { agent } = useAgent({
          agentId: "my-agent",
          threadId: "thread-a",
        });
        watchEffect(() => {
          agents.a = agent.value;
        });
        return {};
      },
      template: "<div />",
    });
    const TrackerB = defineComponent({
      setup() {
        const { agent } = useAgent({
          agentId: "my-agent",
          threadId: "thread-b",
        });
        watchEffect(() => {
          agents.b = agent.value;
        });
        return {};
      },
      template: "<div />",
    });
    const Host = defineComponent({
      components: { TrackerA, TrackerB },
      template: "<div><TrackerA /><TrackerB /></div>",
    });

    render(Host);
    await nextTick();

    expect(agents.a).not.toBe(agents.b);
    expect(agents.a.threadId).toBe("thread-a");
    expect(agents.b.threadId).toBe("thread-b");
  });
});
