import { describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import CopilotChatSuggestionPill from "../CopilotChatSuggestionPill.vue";

describe("CopilotChatSuggestionPill", () => {
  it("renders label content with button defaults", () => {
    const wrapper = mount(CopilotChatSuggestionPill, {
      slots: {
        default: "Draft a project brief",
      },
    });

    const button = wrapper.get("button[data-testid='copilot-chat-suggestion-pill']");
    expect(button.attributes("type")).toBe("button");
    expect(button.text()).toContain("Draft a project brief");
    expect(button.attributes("disabled")).toBeUndefined();
  });

  it("shows loading state and disables interaction", () => {
    const wrapper = mount(CopilotChatSuggestionPill, {
      props: {
        isLoading: true,
      },
      slots: {
        default: "Loading suggestion",
      },
    });

    const button = wrapper.get("button[data-testid='copilot-chat-suggestion-pill']");
    expect(button.attributes("aria-busy")).toBe("true");
    expect(button.attributes("disabled")).toBeDefined();
    expect(wrapper.find(".animate-spin").exists()).toBe(true);
  });

  it("renders icon component when provided", () => {
    const IconComponent = defineComponent({
      template: `<svg data-testid="custom-icon" />`,
    });

    const wrapper = mount(CopilotChatSuggestionPill, {
      props: {
        icon: IconComponent,
      },
      slots: {
        default: "With icon",
      },
    });

    expect(wrapper.find("[data-testid='custom-icon']").exists()).toBe(true);
  });

  it("forwards click handlers via attrs", async () => {
    const onClick = vi.fn();
    const wrapper = mount(CopilotChatSuggestionPill, {
      attrs: {
        onClick,
      },
      slots: {
        default: "Clickable",
      },
    });

    await wrapper.get("button[data-testid='copilot-chat-suggestion-pill']").trigger("click");
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
