import { describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { mount } from "@vue/test-utils";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatToggleButton from "../CopilotChatToggleButton.vue";

describe("CopilotChatToggleButton", () => {
  it("falls back to local state when no provider modal state exists", async () => {
    const wrapper = mount(CopilotChatToggleButton);

    expect(wrapper.attributes("data-state")).toBe("closed");
    expect(wrapper.attributes("aria-pressed")).toBe("false");

    await wrapper.trigger("click");

    expect(wrapper.attributes("data-state")).toBe("open");
    expect(wrapper.attributes("aria-pressed")).toBe("true");
  });

  it("uses provider modal state when available", async () => {
    const wrapper = mount(CopilotChatConfigurationProvider, {
      props: {
        threadId: "toggle-thread",
        isModalDefaultOpen: false,
      },
      slots: {
        default: () => h(CopilotChatToggleButton),
      },
    });

    const button = wrapper.get("[data-slot='chat-toggle-button']");
    expect(button.attributes("data-state")).toBe("closed");

    await button.trigger("click");

    expect(button.attributes("data-state")).toBe("open");
  });

  it("calls native click listeners before toggling and respects preventDefault", async () => {
    const onClick = vi.fn((event: MouseEvent) => {
      event.preventDefault();
    });

    const wrapper = mount(CopilotChatToggleButton, {
      attrs: {
        onClick,
      },
    });

    await wrapper.trigger("click");

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(wrapper.attributes("data-state")).toBe("closed");
  });

  it("honors disabled state", async () => {
    const wrapper = mount(CopilotChatToggleButton, {
      props: {
        disabled: true,
      },
    });

    await wrapper.trigger("click");

    expect(wrapper.attributes("data-state")).toBe("closed");
  });

  it("renders custom open and close icon slots", () => {
    const wrapper = mount(CopilotChatToggleButton, {
      slots: {
        "open-icon": ({ iconClass }: { iconClass: string }) =>
          h("span", { "data-testid": "custom-open-icon", class: iconClass }, "open"),
        "close-icon": ({ iconClass }: { iconClass: string }) =>
          h("span", { "data-testid": "custom-close-icon", class: iconClass }, "close"),
      },
    });

    expect(wrapper.find("[data-testid='custom-open-icon']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='custom-close-icon']").exists()).toBe(true);
  });
});
