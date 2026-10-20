import { MockSocket } from "../../../../../core/src/__tests__/test-utils";
import { cleanup, render, screen, waitFor } from "@testing-library/vue";
import { computed, defineComponent, nextTick, shallowRef } from "vue";
import { expect, test, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import {
  AgentHistoryReplayError,
  CopilotKitCoreErrorCode,
  IntelligenceAgent,
} from "@copilotkit/core";
import { CopilotKitCoreVue } from "../../lib/vue-core";
import { useCopilotKit } from "../../providers/useCopilotKit";
import { useAgent } from "../use-agent";
import { useInterrupt } from "../use-interrupt";

vi.mock("phoenix", () => ({ Socket: MockSocket }));
vi.mock("../../providers/useCopilotKit", () => ({ useCopilotKit: vi.fn() }));
vi.mock("../use-agent", () => ({ useAgent: vi.fn() }));

const InterruptHarness = defineComponent({
  setup() {
    return { hasInterrupt: useInterrupt({ renderInChat: false }).hasInterrupt };
  },
  template: '<button v-if="hasInterrupt">Approve saved action</button>',
});

test("clears a replayed interrupt before failed history finalizes", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            threadId: "test-thread",
            runId: "saved-run",
            joinToken: "token",
            realtime: {
              clientUrl: "ws://localhost/client",
              topic: "thread:test-thread",
            },
          }),
        ),
    ),
  );
  const channels = vi.spyOn(MockSocket.prototype, "channel");
  const agent = new IntelligenceAgent({
    agentId: "default",
    url: "ws://localhost/client",
    runtimeUrl: "http://localhost/runtime",
  });
  agent.threadId = "test-thread";
  const core = new CopilotKitCoreVue({
    agents__unsafe_dev_only: { default: agent },
  });
  vi.mocked(useCopilotKit).mockReturnValue({
    copilotkit: shallowRef(core),
    executingToolCallIds: shallowRef(new Set()),
    a2uiTheme: computed(() => undefined),
    a2uiCatalog: computed(() => undefined),
    a2uiLoadingComponent: computed(() => undefined),
    a2uiIncludeSchema: computed(() => false),
  });
  vi.mocked(useAgent).mockReturnValue({ agent: shallowRef(agent) });
  const onError = vi.fn();
  const errors = core.subscribe({ onError });
  const observed = vi.fn();
  const events = agent.subscribe({ onCustomEvent: observed });
  render(InterruptHarness);
  const connection = core.connectAgent({ agent });
  try {
    await waitFor(() => expect(channels).toHaveBeenCalledOnce());
    const channel = channels.mock.results[0]!.value;
    channel.triggerJoin("ok");
    channel.serverPush("ag_ui_event", {
      type: EventType.CUSTOM,
      name: "on_interrupt",
      value: { question: "Approve saved action?" },
    });
    await waitFor(() => expect(observed).toHaveBeenCalledOnce());
    channel.serverPush("replay_failed", {
      reason: "history_read_timeout",
      retryable: false,
      latestEventId: null,
    });
    await connection;
    await nextTick();
    expect(onError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        code: CopilotKitCoreErrorCode.AGENT_HISTORY_REPLAY_FAILED,
        error: new AgentHistoryReplayError("history_read_timeout"),
      }),
    );
    expect(screen.queryByText("Approve saved action")).toBeNull();
    expect(agent.isRunning).toBe(false);
  } finally {
    await agent.detachActiveRun();
    await connection;
    events.unsubscribe();
    errors.unsubscribe();
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
