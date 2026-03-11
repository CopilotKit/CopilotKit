import { describe, expect, it } from "vitest";
import { computed, h } from "vue";
import { mount } from "@vue/test-utils";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import { useCopilotChatConfiguration } from "../../../providers/useCopilotChatConfiguration";
import { CopilotModalHeader } from "../index";

const ModalStateProbe = {
  setup() {
    const config = useCopilotChatConfiguration();
    const modalState = computed(() => String(config.value?.isModalOpen));
    return () => h("span", { "data-testid": "modal-state" }, modalState.value);
  },
};

describe("CopilotModalHeader", () => {
  it("resolves the default title from chat labels", () => {
    const wrapper = mount(CopilotChatConfigurationProvider, {
      props: {
        threadId: "header-thread",
        labels: {
          modalHeaderTitle: "Workspace Copilot",
        },
      },
      slots: {
        default: () => h(CopilotModalHeader),
      },
    });

    expect(wrapper.text()).toContain("Workspace Copilot");
  });

  it("closes provider modal state when the default close button is clicked", async () => {
    const wrapper = mount(CopilotChatConfigurationProvider, {
      props: {
        threadId: "header-thread",
        isModalDefaultOpen: true,
      },
      slots: {
        default: () => [h(CopilotModalHeader), h(ModalStateProbe)],
      },
    });

    expect(wrapper.get("[data-testid='modal-state']").text()).toBe("true");

    await wrapper.get("button[aria-label='Close']").trigger("click");

    expect(wrapper.get("[data-testid='modal-state']").text()).toBe("false");
  });

  it("forwards title-content and close-button slot payloads", async () => {
    const wrapper = mount(CopilotChatConfigurationProvider, {
      props: {
        threadId: "header-thread",
        isModalDefaultOpen: true,
      },
      slots: {
        default: () => [
          h(
            CopilotModalHeader,
            { title: "Slot Title" },
            {
              "title-content": ({ title }: { title: string }) =>
                h("div", { "data-testid": "custom-title" }, title),
              "close-button": ({ onClose }: { onClose: () => void }) =>
                h("button", { "data-testid": "custom-close", onClick: onClose }, "close"),
            },
          ),
          h(ModalStateProbe),
        ],
      },
    });

    expect(wrapper.get("[data-testid='custom-title']").text()).toBe("Slot Title");
    await wrapper.get("[data-testid='custom-close']").trigger("click");
    expect(wrapper.get("[data-testid='modal-state']").text()).toBe("false");
  });

  it("supports full layout slot overrides", () => {
    const wrapper = mount(CopilotChatConfigurationProvider, {
      props: {
        threadId: "header-thread",
      },
      slots: {
        default: () =>
          h(
            CopilotModalHeader,
            { title: "Layout Title" },
            {
              layout: ({ title }: { title: string }) =>
                h("div", { "data-testid": "custom-layout" }, title),
            },
          ),
      },
    });

    expect(wrapper.get("[data-testid='custom-layout']").text()).toBe("Layout Title");
  });

  it("exposes namespaced Title and CloseButton components", () => {
    expect(CopilotModalHeader.Title).toBeDefined();
    expect(CopilotModalHeader.CloseButton).toBeDefined();
  });
});
