import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { CopilotKitCoreErrorCode } from "@copilotkit/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import { StateCapturingAgent } from "../../../__tests__/utils/agents";
import { useCopilotKit } from "../../../providers/useCopilotKit";
import { CopilotKitCoreVue } from "../../../lib/vue-core";
import CopilotChat from "../CopilotChat.vue";
import CopilotChatView from "../CopilotChatView.vue";
import { getThreadClone } from "../../../hooks/use-agent";

function mountChat(
  props: Record<string, unknown> = {},
  options: {
    agents?: Record<string, StateCapturingAgent>;
    providerThreadId?: string;
    providerProps?: Record<string, unknown>;
    slots?: Record<string, unknown>;
  } = {},
) {
  const agents = options.agents ?? { default: new StateCapturingAgent() };

  return mount(CopilotKitProvider, {
    props: {
      agents__unsafe_dev_only: agents,
      ...options.providerProps,
    },
    slots: {
      default: () =>
        options.providerThreadId
          ? h(
              CopilotChatConfigurationProvider,
              { threadId: options.providerThreadId },
              {
                default: () => h(CopilotChat, props, options.slots),
              },
            )
          : h(CopilotChat, props, options.slots),
    },
  });
}

function MediaRecorderMock() {}

describe("CopilotChat", () => {
  const originalMediaRecorder = globalThis.MediaRecorder;
  const originalFetch = globalThis.fetch;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  interface CopilotKitCoreTestAccess {
    notifySubscribers: (
      handler: (subscriber: {
        onError?: (event: {
          copilotkit: CopilotKitCoreVue;
          error: Error;
          code: CopilotKitCoreErrorCode;
          context: Record<string, any>;
        }) => void | Promise<void>;
      }) => void | Promise<void>,
      errorMessage: string,
    ) => Promise<void>;
  }

  beforeEach(() => {
    globalThis.MediaRecorder =
      MediaRecorderMock as unknown as typeof MediaRecorder;
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
    if (originalMediaRecorder) {
      globalThis.MediaRecorder = originalMediaRecorder;
    } else {
      // @ts-expect-error test cleanup
      delete globalThis.MediaRecorder;
    }
    consoleErrorSpy.mockRestore();
  });

  it("renders customized labels from props", async () => {
    const wrapper = mountChat({
      labels: {
        chatInputPlaceholder: "Custom placeholder text...",
      },
    });

    await nextTick();
    expect(wrapper.find("textarea").attributes("placeholder")).toBe(
      "Custom placeholder text...",
    );
  });

  it("submits a user message and runs the resolved agent", async () => {
    const agent = new StateCapturingAgent();
    const runAgent = vi.spyOn(CopilotKitCoreVue.prototype, "runAgent");
    const wrapper = mountChat({}, { agents: { default: agent } });
    await flushPromises();

    const chat = wrapper.findComponent(CopilotChat);
    await chat
      .findComponent(CopilotChatView)
      .vm.$emit("submit-message", "Hello");
    await flushPromises();

    expect(chat.emitted("submit-message")).toEqual([["Hello"]]);
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: expect.objectContaining({ agentId: "default" }),
      }),
    );
  });

  it("uses the explicit agentId and threadId over inherited configuration", async () => {
    const defaultAgent = new StateCapturingAgent([], "default");
    const customAgent = new StateCapturingAgent([], "custom-agent");
    let core:
      | ReturnType<typeof useCopilotKit>["copilotkit"]["value"]
      | undefined;
    const Probe = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit();
        core = copilotkit.value;
        return () => null;
      },
    });
    const wrapper = mount(CopilotKitProvider, {
      props: {
        agents__unsafe_dev_only: {
          default: defaultAgent,
          "custom-agent": customAgent,
        },
      },
      slots: {
        default: () =>
          h(
            CopilotChatConfigurationProvider,
            { threadId: "provider-thread" },
            {
              default: () =>
                h("div", [
                  h(
                    CopilotChat,
                    {
                      agentId: "custom-agent",
                      threadId: "explicit-thread",
                    },
                    {
                      "chat-view": (slotProps: {
                        onSubmitMessage: (value: string) => Promise<void>;
                      }) =>
                        h(
                          "button",
                          {
                            "data-testid": "submit-via-slot",
                            onClick: () =>
                              void slotProps.onSubmitMessage(
                                "From custom agent",
                              ),
                          },
                          "submit",
                        ),
                    },
                  ),
                  h(Probe),
                ]),
            },
          ),
      },
    });
    await flushPromises();

    await wrapper.get("[data-testid='submit-via-slot']").trigger("click");
    await flushPromises();

    const registryAgent = core?.getAgent("custom-agent");
    const resolvedAgent = getThreadClone(registryAgent, "explicit-thread");
    expect(resolvedAgent?.threadId).toBe("explicit-thread");
    expect(resolvedAgent?.messages.some((m) => m.role === "user")).toBe(true);
    expect(defaultAgent.messages).toHaveLength(0);
  });

  it("does not invoke stop handlers when no active run is available", async () => {
    const agent = new StateCapturingAgent();

    let core:
      | ReturnType<typeof useCopilotKit>["copilotkit"]["value"]
      | undefined;
    const Probe = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit();
        core = copilotkit.value;
        return () => null;
      },
    });

    const wrapper = mount(CopilotKitProvider, {
      props: {
        agents__unsafe_dev_only: { default: agent },
      },
      slots: {
        default: () =>
          h("div", [
            h(
              CopilotChatConfigurationProvider,
              { threadId: "stop-thread" },
              {
                default: () =>
                  h(CopilotChat, null, {
                    "chat-view": (slotProps: { onStop?: () => void }) =>
                      h(
                        "button",
                        {
                          "data-testid": "stop-via-slot",
                          onClick: () => slotProps.onStop?.(),
                        },
                        "stop",
                      ),
                  }),
              },
            ),
            h(Probe),
          ]),
      },
    });
    await flushPromises();

    const registryAgent = core?.getAgent("default");
    const resolvedAgent = getThreadClone(registryAgent, "stop-thread");
    const abortRun = vi.fn();
    if (registryAgent) {
      registryAgent.abortRun = abortRun;
    }
    if (resolvedAgent) {
      resolvedAgent.abortRun = abortRun;
    }

    const stopAgent = vi.spyOn(core!, "stopAgent").mockImplementation(() => {
      throw new Error("stop failed");
    });

    await wrapper.get("[data-testid='stop-via-slot']").trigger("click");

    expect(stopAgent).toHaveBeenCalledTimes(0);
    expect(abortRun).toHaveBeenCalledTimes(0);
  });

  it("transcribes audio through the runtime helper and updates the input value", async () => {
    const onFinishTranscribeWithAudio = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(
      CopilotKitCoreVue.prototype,
      "audioFileTranscriptionEnabled",
      "get",
    ).mockReturnValue(true);

    const wrapper = mountChat(
      {
        onFinishTranscribeWithAudio,
      },
      {
        slots: {
          "chat-view": (slotProps: {
            inputValue?: string;
            onFinishTranscribeWithAudio?: (audioBlob: Blob) => Promise<void>;
          }) =>
            h("div", [
              h("button", {
                "data-testid": "transcribe-via-slot",
                onClick: () =>
                  void slotProps.onFinishTranscribeWithAudio?.(
                    new Blob(["audio"], { type: "audio/webm" }),
                  ),
              }),
              h(
                "div",
                { "data-testid": "input-value" },
                slotProps.inputValue ?? "",
              ),
            ]),
        },
      },
    );

    await wrapper.get("[data-testid='transcribe-via-slot']").trigger("click");
    await flushPromises();
    await nextTick();

    expect(onFinishTranscribeWithAudio).toHaveBeenCalledTimes(1);
    expect(wrapper.get("[data-testid='input-value']").text()).toBe("");
  });

  it("does not reconnect in a loop when connectAgent mutates agent state", async () => {
    const agent = new StateCapturingAgent();
    const connectAgent = vi
      .spyOn(CopilotKitCoreVue.prototype, "connectAgent")
      .mockImplementation(async ({ agent: connectedAgent }) => {
        connectedAgent.setMessages([]);
        connectedAgent.setState({});
        return { newMessages: [] } as Awaited<
          ReturnType<CopilotKitCoreVue["connectAgent"]>
        >;
      });

    const Host = defineComponent({
      components: { CopilotKitProvider, CopilotChat },
      data() {
        return {
          threadId: "thread-a",
        };
      },
      template: `
        <CopilotKitProvider runtime-url="/api/copilotkit" :agents__unsafe_dev_only="{ default: agent }">
          <CopilotChat :thread-id="threadId" />
        </CopilotKitProvider>
      `,
      setup() {
        return { agent };
      },
    });

    const wrapper = mount(Host);
    await flushPromises();

    expect(connectAgent).toHaveBeenCalledTimes(1);

    wrapper.vm.threadId = "thread-b";
    await flushPromises();

    expect(connectAgent).toHaveBeenCalledTimes(2);
  });

  it("filters chat onError to the resolved agent", async () => {
    let core:
      | ReturnType<typeof useCopilotKit>["copilotkit"]["value"]
      | undefined;
    const onError = vi.fn();
    const Probe = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit();
        core = copilotkit.value;
        return () => null;
      },
    });

    mount(CopilotKitProvider, {
      props: {
        agents__unsafe_dev_only: {
          default: new StateCapturingAgent([], "default"),
        },
      },
      slots: {
        default: () =>
          h("div", [
            h(CopilotChat, { welcomeScreen: false, onError }),
            h(Probe),
          ]),
      },
    });

    await (core as unknown as CopilotKitCoreTestAccess).notifySubscribers(
      (subscriber) =>
        subscriber.onError?.({
          copilotkit: core!,
          error: new Error("wrong agent"),
          code: CopilotKitCoreErrorCode.AGENT_RUN_FAILED,
          context: { agentId: "other-agent" },
        }),
      "test chat onError",
    );

    await nextTick();
    expect(onError).not.toHaveBeenCalled();
  });

  it("fires provider and chat onError for the same matching error", async () => {
    let core:
      | ReturnType<typeof useCopilotKit>["copilotkit"]["value"]
      | undefined;
    const providerOnError = vi.fn();
    const chatOnError = vi.fn();
    const Probe = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit();
        core = copilotkit.value;
        return () => null;
      },
    });

    mount(CopilotKitProvider, {
      props: {
        agents__unsafe_dev_only: {
          default: new StateCapturingAgent([], "default"),
        },
        onError: providerOnError,
      },
      slots: {
        default: () =>
          h("div", [
            h(CopilotChat, { welcomeScreen: false, onError: chatOnError }),
            h(Probe),
          ]),
      },
    });

    await (core as unknown as CopilotKitCoreTestAccess).notifySubscribers(
      (subscriber) =>
        subscriber.onError?.({
          copilotkit: core!,
          error: new Error("matching agent"),
          code: CopilotKitCoreErrorCode.AGENT_RUN_FAILED,
          context: { agentId: "default" },
        }),
      "test chat onError",
    );

    await nextTick();

    expect(providerOnError).toHaveBeenCalledTimes(1);
    expect(chatOnError).toHaveBeenCalledTimes(1);
    expect(chatOnError.mock.calls[0][0].code).toBe(
      CopilotKitCoreErrorCode.AGENT_RUN_FAILED,
    );
  });

  it("forwards the interrupt slot through CopilotChat", async () => {
    let core:
      | ReturnType<typeof useCopilotKit>["copilotkit"]["value"]
      | undefined;
    const Probe = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit();
        core = copilotkit.value;
        return () => null;
      },
    });

    const wrapper = mount(CopilotKitProvider, {
      props: {
        agents__unsafe_dev_only: {
          default: new StateCapturingAgent([], "default"),
        },
      },
      slots: {
        default: () =>
          h("div", [
            h(
              CopilotChat,
              { welcomeScreen: false },
              {
                interrupt: ({ event }: { event: { value: string } }) =>
                  h("div", { "data-testid": "chat-interrupt" }, event.value),
              },
            ),
            h(Probe),
          ]),
      },
    });

    core?.setInterruptState({
      event: { name: "on_interrupt", value: "slot-forwarded" },
      result: null,
      resolve: () => undefined,
    });
    await nextTick();

    expect(wrapper.get("[data-testid=chat-interrupt]").text()).toBe(
      "slot-forwarded",
    );
  });

  it("calls connectAgent for local agents even without a runtimeUrl", async () => {
    const agent = new StateCapturingAgent();
    const connectAgent = vi
      .spyOn(CopilotKitCoreVue.prototype, "connectAgent")
      .mockImplementation(async () => {
        return { newMessages: [] } as Awaited<
          ReturnType<CopilotKitCoreVue["connectAgent"]>
        >;
      });

    mountChat({ threadId: "local-thread" }, { agents: { default: agent } });
    await flushPromises();

    expect(connectAgent).toHaveBeenCalledTimes(1);
    expect(connectAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: expect.objectContaining({
          agentId: "default",
          threadId: "local-thread",
        }),
      }),
    );
  });

  it("does not crash when a local agent connect() throws AGUIConnectNotImplementedError", async () => {
    // Provide an explicit threadId so the new connect-gating logic actually
    // exercises the connectAgent call path. Without one, /connect is skipped
    // entirely (locally-minted UUID would 404), and this test would become
    // a silent no-op.
    const agent = new StateCapturingAgent();

    mountChat({ threadId: "explicit-thread" }, { agents: { default: agent } });
    await flushPromises();

    expect(agent.threadId).toBeDefined();
  });

  describe("connect-gating (ENT-314)", () => {
    it("does not call connectAgent when no threadId is supplied", async () => {
      // Locally-minted UUID has never been seen by the backend; calling
      // /connect against it would always 404. Skip the call entirely.
      const agent = new StateCapturingAgent();
      const connectAgent = vi.spyOn(
        CopilotKitCoreVue.prototype,
        "connectAgent",
      );

      mountChat({ welcomeScreen: false }, { agents: { default: agent } });
      await flushPromises();

      expect(connectAgent).not.toHaveBeenCalled();
    });

    it("calls connectAgent when threadId is supplied via props", async () => {
      const agent = new StateCapturingAgent();
      const connectAgent = vi.spyOn(
        CopilotKitCoreVue.prototype,
        "connectAgent",
      );

      mountChat(
        { welcomeScreen: false, threadId: "user-thread-abc" },
        { agents: { default: agent } },
      );
      await flushPromises();

      expect(connectAgent).toHaveBeenCalled();
    });

    it("calls connectAgent when threadId is supplied via configuration provider", async () => {
      const agent = new StateCapturingAgent();
      const connectAgent = vi.spyOn(
        CopilotKitCoreVue.prototype,
        "connectAgent",
      );

      mountChat(
        { welcomeScreen: false },
        {
          agents: { default: agent },
          providerThreadId: "config-thread-xyz",
        },
      );
      await flushPromises();

      expect(connectAgent).toHaveBeenCalled();
    });

    it("does not call connectAgent when configuration provider supplies threadId with hasExplicitThreadId=false", async () => {
      // Mirrors the "auto-minted UUID leaking down" scenario where a parent
      // provider supplies a threadId but flags it as non-explicit. This is
      // the Vue equivalent of React's CopilotKit → ThreadsProvider → UUID
      // chain and must NOT trigger /connect.
      const agent = new StateCapturingAgent();
      const connectAgent = vi.spyOn(
        CopilotKitCoreVue.prototype,
        "connectAgent",
      );

      mount(CopilotKitProvider, {
        props: {
          agents__unsafe_dev_only: { default: agent },
        },
        slots: {
          default: () =>
            h(
              CopilotChatConfigurationProvider,
              {
                threadId: "auto-minted-uuid",
                hasExplicitThreadId: false,
              },
              {
                default: () => h(CopilotChat, { welcomeScreen: false }),
              },
            ),
        },
      });
      await flushPromises();

      expect(connectAgent).not.toHaveBeenCalled();
    });

    it("flips isConnecting from true to false once connectAgent resolves (raf-deferred)", async () => {
      // Capture isConnecting via the chat-view slot before and after the
      // connect promise settles. The raf defer is handled in jsdom because
      // requestAnimationFrame is polyfilled by the environment.
      const agent = new StateCapturingAgent();
      vi.spyOn(CopilotKitCoreVue.prototype, "connectAgent").mockImplementation(
        async () => {
          return { newMessages: [] } as Awaited<
            ReturnType<CopilotKitCoreVue["connectAgent"]>
          >;
        },
      );

      const observed: Array<boolean | undefined> = [];

      const Recorder = defineComponent({
        props: {
          isConnecting: { type: Boolean, default: undefined },
        },
        setup(slotProps) {
          return () => {
            observed.push(slotProps.isConnecting);
            return null;
          };
        },
      });

      mount(CopilotKitProvider, {
        props: {
          agents__unsafe_dev_only: { default: agent },
        },
        slots: {
          default: () =>
            h(
              CopilotChat,
              { welcomeScreen: false, threadId: "explicit-thread" },
              {
                "chat-view": (slotProps: { isConnecting?: boolean }) =>
                  h(Recorder, { isConnecting: slotProps.isConnecting }),
              },
            ),
        },
      });

      await flushPromises();
      // Wait one extra microtask + macrotask so raf callbacks fire.
      await new Promise((resolve) => setTimeout(resolve, 32));
      await nextTick();

      // Initial render should have observed isConnecting=true at least once,
      // and the latest observation should be false.
      expect(observed.some((value) => value === true)).toBe(true);
      expect(observed[observed.length - 1]).toBe(false);
    });
  });
});
