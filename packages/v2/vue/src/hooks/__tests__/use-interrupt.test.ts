import { mount } from "@vue/test-utils";
import { computed, defineComponent, h, nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCopilotKit } from "../../providers/useCopilotKit";
import { useAgent } from "../use-agent";
import { useInterrupt } from "../use-interrupt";

vi.mock("../../providers/useCopilotKit", () => ({
  useCopilotKit: vi.fn(),
}));

vi.mock("../use-agent", () => ({
  useAgent: vi.fn(),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;
const mockUseAgent = useAgent as ReturnType<typeof vi.fn>;

type SubscriptionHandlers = {
  onCustomEvent?: (payload: {
    event: { name: string; value: unknown };
  }) => void;
  onRunStartedEvent?: () => void;
  onRunFinalized?: () => void;
  onRunFailed?: () => void;
};

describe("useInterrupt", () => {
  let runAgentMock: ReturnType<typeof vi.fn>;
  let setInterruptStateMock: ReturnType<typeof vi.fn>;
  let unsubscribeMock: ReturnType<typeof vi.fn>;
  let subscribeMock: ReturnType<typeof vi.fn>;
  let handlers: SubscriptionHandlers;
  let mockAgent: Record<string, unknown>;
  let coreState: {
    runAgent: ReturnType<typeof vi.fn>;
    setInterruptState: ReturnType<typeof vi.fn>;
    interruptState: unknown;
  };

  beforeEach(() => {
    runAgentMock = vi.fn();
    unsubscribeMock = vi.fn();
    handlers = {};

    subscribeMock = vi.fn((nextHandlers: SubscriptionHandlers) => {
      handlers = nextHandlers;
      return { unsubscribe: unsubscribeMock };
    });

    mockAgent = {
      subscribe: subscribeMock,
      id: "test-agent",
    };

    coreState = {
      runAgent: runAgentMock,
      setInterruptState: vi.fn((value: unknown) => {
        coreState.interruptState = value;
      }),
      interruptState: null,
    };
    setInterruptStateMock = coreState.setInterruptState;

    mockUseCopilotKit.mockReturnValue({
      copilotkit: {
        value: coreState,
      },
    });

    mockUseAgent.mockReturnValue({
      agent: computed(() => mockAgent),
    });
  });

  function mountHarness(options: {
    enabled?: (event: { name: string; value: unknown }) => boolean;
    handler?: (props: {
      event: { name: string; value: unknown };
      resolve: (response: unknown) => void;
    }) => unknown;
    renderInChat?: boolean;
  } = {}) {
    const Harness = defineComponent({
      setup() {
        const interrupt = useInterrupt({
          enabled: options.enabled,
          handler: options.handler,
          renderInChat: options.renderInChat,
        });

        return () => {
          const payload = interrupt.slotProps.value;
          if (!payload) {
            return h("div", { "data-testid": "interrupt-state" }, "idle");
          }

          return h("button", {
            "data-testid": "interrupt-state",
            onClick: () =>
              payload.resolve({
                approved: true,
                value: payload.event.value,
              }),
          }, `${String(payload.result ?? "no-result")}:${String(payload.event.value)}`);
        };
      },
    });

    return mount(Harness);
  }

  function emitInterrupt(value: unknown) {
    handlers.onCustomEvent?.({
      event: { name: "on_interrupt", value },
    });
    handlers.onRunFinalized?.();
  }

  it("subscribes on mount and unsubscribes on unmount", () => {
    const wrapper = mountHarness({ renderInChat: false });

    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(handlers.onCustomEvent).toBeTypeOf("function");
    expect(handlers.onRunStartedEvent).toBeTypeOf("function");
    expect(handlers.onRunFinalized).toBeTypeOf("function");
    expect(handlers.onRunFailed).toBeTypeOf("function");

    wrapper.unmount();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it("ignores non-interrupt custom events", () => {
    const wrapper = mountHarness({ renderInChat: false });

    handlers.onCustomEvent?.({
      event: { name: "not_interrupt", value: "x" },
    });
    handlers.onRunFinalized?.();

    expect(wrapper.get("[data-testid=interrupt-state]").text()).toBe("idle");
  });

  it("renders interrupt only after run finalized", async () => {
    const wrapper = mountHarness({ renderInChat: false });

    handlers.onCustomEvent?.({
      event: { name: "on_interrupt", value: "pending" },
    });
    await nextTick();
    expect(wrapper.get("[data-testid=interrupt-state]").text()).toBe("idle");

    handlers.onRunFinalized?.();
    await nextTick();
    expect(wrapper.get("[data-testid=interrupt-state]").text()).toContain("pending");
  });

  it("clears pending interrupt on run start", async () => {
    const wrapper = mountHarness({ renderInChat: false });

    emitInterrupt("first");
    await nextTick();
    expect(wrapper.get("[data-testid=interrupt-state]").text()).toContain("first");

    handlers.onRunStartedEvent?.();
    await nextTick();
    expect(wrapper.get("[data-testid=interrupt-state]").text()).toBe("idle");
  });

  it("resolve clears UI and resumes agent with response payload", async () => {
    const wrapper = mountHarness({ renderInChat: false });

    emitInterrupt("approve-me");
    await nextTick();
    await wrapper.get("[data-testid=interrupt-state]").trigger("click");
    await nextTick();

    expect(wrapper.get("[data-testid=interrupt-state]").text()).toBe("idle");
    expect(runAgentMock).toHaveBeenCalledWith({
      agent: mockAgent,
      forwardedProps: {
        command: {
          resume: { approved: true, value: "approve-me" },
        },
      },
    });
  });

  it("does not render and does not run handler when enabled returns false", async () => {
    const handler = vi.fn(() => "should-not-run");
    const wrapper = mountHarness({
      renderInChat: false,
      enabled: () => false,
      handler,
    });

    emitInterrupt("blocked");
    await nextTick();

    expect(wrapper.get("[data-testid=interrupt-state]").text()).toBe("idle");
    expect(handler).not.toHaveBeenCalled();
  });

  it("renders with null result when no handler is provided", async () => {
    const wrapper = mountHarness({ renderInChat: false });

    emitInterrupt("no-handler");
    await nextTick();

    expect(wrapper.get("[data-testid=interrupt-state]").text()).toContain(
      "no-result:no-handler",
    );
  });

  it("uses sync handler result", async () => {
    const wrapper = mountHarness({
      renderInChat: false,
      handler: ({ event }) => `handled:${String(event.value)}`,
    });

    emitInterrupt("sync");
    await nextTick();

    expect(wrapper.get("[data-testid=interrupt-state]").text()).toContain("handled:sync");
  });

  it("uses async handler resolved value", async () => {
    const wrapper = mountHarness({
      renderInChat: false,
      handler: ({ event }) => Promise.resolve(`async:${String(event.value)}`),
    });

    emitInterrupt("value");
    await Promise.resolve();
    await Promise.resolve();
    await nextTick();

    expect(wrapper.get("[data-testid=interrupt-state]").text()).toContain("async:value");
  });

  it("falls back to null result when async handler rejects", async () => {
    const wrapper = mountHarness({
      renderInChat: false,
      handler: () => Promise.reject(new Error("boom")),
    });

    emitInterrupt("reject");
    await Promise.resolve();
    await Promise.resolve();
    await nextTick();

    expect(wrapper.get("[data-testid=interrupt-state]").text()).toContain("no-result:reject");
  });

  it("publishes interrupt state to chat by default and clears on unmount", async () => {
    const wrapper = mountHarness();

    emitInterrupt("chat");
    await nextTick();

    expect(setInterruptStateMock).toHaveBeenCalled();
    expect(setInterruptStateMock.mock.calls.at(-1)?.[0]).toMatchObject({
      event: { name: "on_interrupt", value: "chat" },
      result: null,
    });

    wrapper.unmount();
    expect(setInterruptStateMock.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it("does not publish to chat when renderInChat is false", async () => {
    mountHarness({ renderInChat: false });

    emitInterrupt("manual");
    await nextTick();

    expect(setInterruptStateMock).not.toHaveBeenCalled();
  });

  it("discards local interrupt when run fails before finalize", async () => {
    const wrapper = mountHarness({ renderInChat: false });

    handlers.onCustomEvent?.({
      event: { name: "on_interrupt", value: "lost" },
    });
    handlers.onRunFailed?.();
    handlers.onRunFinalized?.();
    await nextTick();

    expect(wrapper.get("[data-testid=interrupt-state]").text()).toBe("idle");
  });
});
