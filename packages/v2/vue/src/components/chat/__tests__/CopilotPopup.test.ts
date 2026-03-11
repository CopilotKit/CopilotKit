import { describe, expect, it } from "vitest";
import { h } from "vue";
import { mount } from "@vue/test-utils";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import { StateCapturingAgent } from "../../../__tests__/utils/agents";
import CopilotPopup from "../CopilotPopup.vue";

function mountPopup(props: Record<string, unknown> = {}, slots: Parameters<typeof h>[2] = {}) {
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
    expect(wrapper.find("[data-testid='copilot-popup-welcome-screen']").exists()).toBe(true);
  });

  it("forwards wrapper props to the popup view", () => {
    const wrapper = mountPopup({
      width: 480,
      height: 640,
    });

    expect(wrapper.get("[data-copilot-popup]").attributes("style")).toContain("--copilot-popup-width: 480px");
    expect(wrapper.get("[data-copilot-popup]").attributes("style")).toContain("--copilot-popup-height: 640px");
  });

  it("allows overriding the chat-view slot", () => {
    const wrapper = mountPopup(
      {},
      {
        "chat-view": () => h("div", { "data-testid": "custom-popup-chat-view" }, "Custom popup"),
      },
    );

    expect(wrapper.find("[data-testid='custom-popup-chat-view']").exists()).toBe(true);
    expect(wrapper.find("[data-copilot-popup]").exists()).toBe(false);
  });
});
