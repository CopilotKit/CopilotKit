import { describe, expect, it } from "vitest";
import { h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import { StateCapturingAgent } from "../../../__tests__/utils/agents";
import { mountWithProvider } from "../../../__tests__/utils/mount";
import CopilotPopup from "../CopilotPopup.vue";

function mountPopup(
  props: Record<string, unknown> = {},
  slots: Parameters<typeof h>[2] = {},
) {
  return mount(CopilotKitProvider, {
    props: { agents__unsafe_dev_only: { default: new StateCapturingAgent() } },
    slots: {
      default: () => h(CopilotPopup, props, slots),
    },
  });
}

describe("CopilotPopup", () => {
  it("uses the popup welcome screen by default", () => {
    const wrapper = mountPopup();

    expect(wrapper.find("[data-copilot-popup]").exists()).toBe(true);
    expect(
      wrapper.find("[data-testid='copilot-popup-welcome-screen']").exists(),
    ).toBe(true);
  });

  it("forwards wrapper props to the popup view", () => {
    const wrapper = mountPopup({
      width: 480,
      height: 640,
    });

    expect(wrapper.get("[data-copilot-popup]").attributes("style")).toContain(
      "--copilot-popup-width: 480px",
    );
    expect(wrapper.get("[data-copilot-popup]").attributes("style")).toContain(
      "--copilot-popup-height: 640px",
    );
  });

  it("allows overriding the chat-view slot", () => {
    const wrapper = mountPopup(
      {},
      {
        "chat-view": () =>
          h("div", { "data-testid": "custom-popup-chat-view" }, "Custom popup"),
      },
    );

    expect(
      wrapper.find("[data-testid='custom-popup-chat-view']").exists(),
    ).toBe(true);
    expect(wrapper.find("[data-copilot-popup]").exists()).toBe(false);
  });

  it("forwards the scroll-view slot to the chat view", () => {
    const wrapper = mountPopup(
      { welcomeScreen: false },
      {
        "scroll-view": ({ messages }: { messages: unknown[] }) =>
          h(
            "div",
            { "data-testid": "custom-popup-scroll-view" },
            String(messages.length),
          ),
      },
    );

    expect(wrapper.get("[data-testid='custom-popup-scroll-view']").text()).toBe(
      "0",
    );
    expect(
      wrapper.find("[data-testid='copilot-chat-view-scroll']").exists(),
    ).toBe(false);
  });

  it("forwards the interrupt slot to the chat view", async () => {
    const { wrapper, getCore } = mountWithProvider(
      () =>
        h(
          CopilotPopup,
          { welcomeScreen: false },
          {
            interrupt: ({ event }: { event: { value: string } }) =>
              h("div", { "data-testid": "popup-interrupt" }, event.value),
          },
        ),
      {
        runtimeUrl: undefined,
        agents__unsafe_dev_only: { default: new StateCapturingAgent() },
      },
    );

    getCore().setInterruptState({
      event: { name: "on_interrupt", value: "slot-forwarded" },
      result: null,
      resolve: () => undefined,
    });
    await nextTick();

    expect(wrapper.get("[data-testid='popup-interrupt']").text()).toBe(
      "slot-forwarded",
    );
  });
});
