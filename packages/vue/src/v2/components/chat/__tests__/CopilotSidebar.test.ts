import { describe, expect, it } from "vitest";
import { h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import { StateCapturingAgent } from "../../../__tests__/utils/agents";
import { mountWithProvider } from "../../../__tests__/utils/mount";
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

  it("forwards the scroll-view slot to the chat view", () => {
    const wrapper = mountSidebar(
      { welcomeScreen: false },
      {
        "scroll-view": ({ messages }: { messages: unknown[] }) =>
          h(
            "div",
            { "data-testid": "custom-sidebar-scroll-view" },
            String(messages.length),
          ),
      },
    );

    expect(
      wrapper.get("[data-testid='custom-sidebar-scroll-view']").text(),
    ).toBe("0");
    expect(
      wrapper.find("[data-testid='copilot-chat-view-scroll']").exists(),
    ).toBe(false);
  });

  it("forwards the interrupt slot to the chat view", async () => {
    const { wrapper, getCore } = mountWithProvider(
      () =>
        h(
          CopilotSidebar,
          { welcomeScreen: false },
          {
            interrupt: ({ event }: { event: { value: string } }) =>
              h("div", { "data-testid": "sidebar-interrupt" }, event.value),
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

    expect(wrapper.get("[data-testid='sidebar-interrupt']").text()).toBe(
      "slot-forwarded",
    );
  });
});
