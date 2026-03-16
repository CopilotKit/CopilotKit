import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import { StateCapturingAgent } from "../../../__tests__/utils/agents";
import { useCopilotKit } from "../../../providers/useCopilotKit";
import { CopilotKitCoreVue } from "../../../lib/vue-core";
import CopilotChat from "../CopilotChat.vue";
import CopilotChatView from "../CopilotChatView.vue";

function mountChat(
  props: Record<string, unknown> = {},
  options: {
    agents?: Record<string, StateCapturingAgent>;
    providerThreadId?: string;
    slots?: Record<string, unknown>;
  } = {},
) {
  const agents = options.agents ?? { default: new StateCapturingAgent() };

  return mount(CopilotKitProvider, {
    props: {
      agents__unsafe_dev_only: agents,
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

describe("CopilotChat", () => {
  const originalMediaRecorder = globalThis.MediaRecorder;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.MediaRecorder = class MediaRecorder {} as typeof MediaRecorder;
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
    const runAgent = vi.spyOn(agent, "runAgent");
    const wrapper = mountChat({}, { agents: { default: agent } });

    const chat = wrapper.findComponent(CopilotChat);
    await chat
      .findComponent(CopilotChatView)
      .vm.$emit("submit-message", "Hello");
    await flushPromises();

    expect(chat.emitted("submit-message")).toEqual([["Hello"]]);
    expect(agent.messages.some((message) => message.content === "Hello")).toBe(
      true,
    );
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it("uses the explicit agentId and threadId over inherited configuration", async () => {
    const defaultAgent = new StateCapturingAgent([], "default");
    const customAgent = new StateCapturingAgent([], "custom-agent");
    const wrapper = mountChat(
      {
        agentId: "custom-agent",
        threadId: "explicit-thread",
      },
      {
        agents: {
          default: defaultAgent,
          "custom-agent": customAgent,
        },
        providerThreadId: "provider-thread",
        slots: {
          "chat-view": (slotProps: {
            onSubmitMessage: (value: string) => Promise<void>;
          }) =>
            h(
              "button",
              {
                "data-testid": "submit-via-slot",
                onClick: () =>
                  void slotProps.onSubmitMessage("From custom agent"),
              },
              "submit",
            ),
        },
      },
    );

    await wrapper.get("[data-testid='submit-via-slot']").trigger("click");
    await flushPromises();

    expect(customAgent.threadId).toBe("explicit-thread");
    expect(
      customAgent.messages.some(
        (message) => message.content === "From custom agent",
      ),
    ).toBe(true);
    expect(defaultAgent.messages).toHaveLength(0);
  });

  it("falls back to abortRun when stopAgent throws", async () => {
    const agent = new StateCapturingAgent();
    agent.messages = [
      {
        id: "running-message",
        role: "assistant",
        content: "Running",
      },
    ];
    agent.isRunning = true;
    agent.abortRun = vi.fn();

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
            h(Probe),
          ]),
      },
    });

    const stopAgent = vi.spyOn(core!, "stopAgent").mockImplementation(() => {
      throw new Error("stop failed");
    });

    await wrapper.get("[data-testid='stop-via-slot']").trigger("click");

    expect(stopAgent).toHaveBeenCalledTimes(1);
    expect(agent.abortRun).toHaveBeenCalledTimes(1);
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
      .mockImplementation(async ({ agent }) => {
        agent.setMessages([]);
        agent.setState({});
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
});
