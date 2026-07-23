import { describe, expect, it } from "vitest";
import { h } from "vue";
import { mount } from "@vue/test-utils";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import { StateCapturingAgent } from "../../../__tests__/utils/agents";
import CopilotSidebar from "../CopilotSidebar.vue";

function mountSidebar(
  props: Record<string, unknown> = {},
  slots: Parameters<typeof h>[2] = {},
) {
  return mount(CopilotKitProvider, {
    props: { agents__unsafe_dev_only: { default: new StateCapturingAgent() } },
    slots: {
      default: () => h(CopilotSidebar, props, slots),
    },
  });
}

describe("CopilotSidebar", () => {
  it("uses the sidebar welcome screen by default", () => {
    const wrapper = mountSidebar();

    expect(wrapper.find("[data-copilot-sidebar]").exists()).toBe(true);
    expect(
      wrapper.find("[data-testid='copilot-sidebar-welcome-screen']").exists(),
    ).toBe(true);
  });

  it("forwards wrapper props to the sidebar view", () => {
    const wrapper = mountSidebar({
      width: 512,
    });

    expect(wrapper.get("[data-copilot-sidebar]").attributes("style")).toContain(
      "--sidebar-width: 512px",
    );
  });

  it("allows overriding the chat-view slot", () => {
    const wrapper = mountSidebar(
      {},
      {
        "chat-view": () =>
          h(
            "div",
            { "data-testid": "custom-sidebar-chat-view" },
            "Custom sidebar",
          ),
      },
    );

    expect(
      wrapper.find("[data-testid='custom-sidebar-chat-view']").exists(),
    ).toBe(true);
    expect(wrapper.find("[data-copilot-sidebar]").exists()).toBe(false);
  });
});
