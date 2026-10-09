import { mount } from "@vue/test-utils";
import { computed, defineComponent, h, nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Interrupt } from "@ag-ui/client";
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

type RunFinishedParams =
  | { outcome: "success"; result?: unknown }
  | { outcome: "interrupt"; interrupts: Interrupt[] };

type SubscriptionHandlers = {
  onCustomEvent?: (payload: {
    event: { name: string; value: unknown };
  }) => void;
  onRunStartedEvent?: () => void;
  onRunFinishedEvent?: (params: RunFinishedParams) => void;
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
    runAgentMock = vi.fn().mockResolvedValue(undefined);
    unsubscribeMock = vi.fn();
    handlers = {};

    subscribeMock = vi.fn((nextHandlers: SubscriptionHandlers) => {
      handlers = nextHandlers;
      return { unsubscribe: unsubscribeMock };
    });

    mockAgent = {
      subscribe: subscribeMock,
      id: "test-agent",
      pendingInterrupts: [] as Interrupt[],
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

  function mountHarness(
    options: {
      enabled?: (event: { name: string; value: unknown }) => boolean;
      handler?: (props: {
        event: { name: string; value: unknown };
        resolve: (response: unknown) => void;
      }) => unknown;
      renderInChat?: boolean;
    } = {},
  ) {
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

          return h(
            "button",
            {
              "data-testid": "interrupt-state",
              onClick: () =>
                payload.resolve({
                  approved: true,
                  value: payload.event.value,
                }),
            },
            `${String(payload.result ?? "no-result")}:${String(payload.event.value)}`,
          );
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
    expect(wrapper.get("[data-testid=interrupt-state]").text()).toContain(
      "pending",
    );
  });

  it("clears pending interrupt on run start", async () => {
    const wrapper = mountHarness({ renderInChat: false });

    emitInterrupt("first");
    await nextTick();
    expect(wrapper.get("[data-testid=interrupt-state]").text()).toContain(
      "first",
    );

    handlers.onRunStartedEvent?.();
    await nextTick();
    expect(wrapper.get("[data-testid=interrupt-state]").text()).toBe("idle");
  });

  it("resolve keeps card mounted until run starts, then resumes agent with response payload", async () => {
    // Legacy resolve must NOT clear pending synchronously; it relies on
    // onRunStartedEvent (fired by the resume run) to unmount the card —
    // matching react-core's behavior.
    const wrapper = mountHarness({ renderInChat: false });

    emitInterrupt("approve-me");
    await nextTick();

    // Trigger resolve (click the interrupt card).
    await wrapper.get("[data-testid=interrupt-state]").trigger("click");
    await nextTick();
    await Promise.resolve();

    // Card must still be mounted — runAgent was dispatched but the run hasn't started yet.
    expect(wrapper.get("[data-testid=interrupt-state]").text()).not.toBe(
      "idle",
    );
    expect(runAgentMock).toHaveBeenCalledWith({
      agent: mockAgent,
      forwardedProps: {
        command: {
          resume: { approved: true, value: "approve-me" },
          interruptEvent: "approve-me",
        },
      },
    });

    // Simulate the resume run starting — onRunStartedEvent clears pending.
    handlers.onRunStartedEvent?.();
    await nextTick();
    expect(wrapper.get("[data-testid=interrupt-state]").text()).toBe("idle");
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

  it("uses sync handler result in render", async () => {
    const wrapper = mountHarness({
      renderInChat: false,
      handler: ({ event }) => `handled:${String(event.value)}`,
    });

    emitInterrupt("sync");
    await nextTick();

    expect(wrapper.get("[data-testid=interrupt-state]").text()).toContain(
      "handled:sync",
    );
  });

  it("uses async handler resolved value in render", async () => {
    const wrapper = mountHarness({
      renderInChat: false,
      handler: ({ event }) => Promise.resolve(`async:${String(event.value)}`),
    });

    emitInterrupt("value");
    await Promise.resolve();
    await Promise.resolve();
    await nextTick();

    expect(wrapper.get("[data-testid=interrupt-state]").text()).toContain(
      "async:value",
    );
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

    expect(wrapper.get("[data-testid=interrupt-state]").text()).toContain(
      "no-result:reject",
    );
  });

  it("accepts thenable handler results (non-native Promise)", async () => {
    const wrapper = mountHarness({
      renderInChat: false,
      handler: () => Promise.resolve("thenable-ok"),
    });

    emitInterrupt("thenable");
    await Promise.resolve();
    await Promise.resolve();
    await nextTick();

    expect(wrapper.get("[data-testid=interrupt-state]").text()).toContain(
      "thenable-ok:thenable",
    );
  });

  it("publishes interrupt element to chat by default and clears on unmount", async () => {
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

  it("does not publish to chat and returns manual element when renderInChat is false", async () => {
    const wrapper = mountHarness({ renderInChat: false });

    emitInterrupt("manual");
    await nextTick();

    expect(wrapper.get("[data-testid=interrupt-state]").text()).toContain(
      "manual",
    );
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

  it("keeps the latest interrupt when multiple interrupts arrive within one run", async () => {
    const wrapper = mountHarness({ renderInChat: false });

    handlers.onCustomEvent?.({
      event: { name: "on_interrupt", value: "first" },
    });
    handlers.onCustomEvent?.({
      event: { name: "on_interrupt", value: "second" },
    });
    handlers.onRunFinalized?.();
    await nextTick();

    expect(wrapper.get("[data-testid=interrupt-state]").text()).toContain(
      "second",
    );
  });

  describe("AG-UI standard interrupts (vue)", () => {
    const INT: Interrupt = {
      id: "int-1",
      reason: "confirmation",
      message: "Approve?",
    };

    /** Mount a component that exposes resolve/cancel from slotProps. */
    function mountStandardHarness() {
      const Harness = defineComponent({
        setup() {
          const { slotProps } = useInterrupt({ renderInChat: false });
          return () => {
            const props = slotProps.value;
            if (!props) return h("div", { "data-testid": "idle" }, "idle");
            return h("div", { "data-testid": "active" }, [
              h(
                "button",
                {
                  "data-testid": "resolve-btn",
                  onClick: () => void props.resolve({ ok: true }),
                },
                "resolve",
              ),
              h(
                "button",
                {
                  "data-testid": "cancel-btn",
                  onClick: () => void props.cancel(),
                },
                "cancel",
              ),
            ]);
          };
        },
      });
      return mount(Harness);
    }

    /** Fire the standard interrupt sequence through the subscription handlers. */
    function fireStandardInterrupt(interrupts: Interrupt[]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockAgent as any).pendingInterrupts = interrupts;
      handlers.onRunStartedEvent?.();
      handlers.onRunFinishedEvent?.({ outcome: "interrupt", interrupts });
      handlers.onRunFinalized?.();
    }

    it("resolveInterrupt resumes with a resolved ResumeEntry", async () => {
      runAgentMock.mockResolvedValue({ result: undefined, newMessages: [] });
      const wrapper = mountStandardHarness();

      fireStandardInterrupt([INT]);
      await nextTick();

      // Click the resolve button (which calls props.resolve({ ok: true }))
      await wrapper.get("[data-testid=resolve-btn]").trigger("click");
      await nextTick();
      await Promise.resolve();
      await nextTick();

      expect(runAgentMock).toHaveBeenCalledWith({
        agent: mockAgent,
        resume: [
          { interruptId: "int-1", status: "resolved", payload: { ok: true } },
        ],
      });
    });

    it("cancelInterrupt resumes with a cancelled ResumeEntry (no payload)", async () => {
      runAgentMock.mockResolvedValue({ result: undefined, newMessages: [] });
      const wrapper = mountStandardHarness();

      fireStandardInterrupt([INT]);
      await nextTick();

      // Click the cancel button (which calls props.cancel())
      await wrapper.get("[data-testid=cancel-btn]").trigger("click");
      await nextTick();
      await Promise.resolve();
      await nextTick();

      expect(runAgentMock).toHaveBeenCalledWith({
        agent: mockAgent,
        resume: [{ interruptId: "int-1", status: "cancelled" }],
      });
    });

    it("warns when resolve is called without interruptId while multiple interrupts are open", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const INT2: Interrupt = { id: "int-2", reason: "confirmation" };

      let capturedResolve: ((payload?: unknown) => void) | undefined;
      const Harness = defineComponent({
        setup() {
          const { slotProps } = useInterrupt({ renderInChat: false });
          capturedResolve = (payload?: unknown) =>
            void slotProps.value?.resolve(payload);
          return () => h("div");
        },
      });
      mount(Harness);

      // Fire standard interrupt with 2 open interrupts.
      fireStandardInterrupt([INT, INT2]);
      await nextTick();

      // Call resolve without an interruptId while 2 interrupts are open.
      await capturedResolve?.({ a: 1 });
      await nextTick();
      await Promise.resolve();

      // Warning must have fired.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("2 interrupts are open"),
      );
      // Only primary addressed — runAgent must NOT have been called yet.
      expect(runAgentMock).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it("legacy on_interrupt still resumes via forwardedProps.command", async () => {
      runAgentMock.mockResolvedValue({ result: undefined, newMessages: [] });

      // Use resolveInterrupt directly from the composable for the legacy path.
      let capturedResolve: ((payload: unknown) => void) | undefined;
      const Harness = defineComponent({
        setup() {
          const { slotProps, resolveInterrupt } = useInterrupt({
            renderInChat: false,
          });
          capturedResolve = resolveInterrupt;
          return () => {
            const props = slotProps.value;
            if (!props) return h("div", { "data-testid": "idle" }, "idle");
            return h("div", { "data-testid": "active" }, "active");
          };
        },
      });
      mount(Harness);

      // Fire legacy on_interrupt path
      handlers.onRunStartedEvent?.();
      handlers.onCustomEvent?.({
        event: { name: "on_interrupt", value: "q?" },
      });
      handlers.onRunFinalized?.();
      await nextTick();

      // Call resolve with legacy payload
      await capturedResolve?.({ approved: true });
      await nextTick();
      await Promise.resolve();

      expect(runAgentMock).toHaveBeenCalledWith({
        agent: mockAgent,
        forwardedProps: {
          command: { resume: { approved: true }, interruptEvent: "q?" },
        },
      });
    });
  });
});
