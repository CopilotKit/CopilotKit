import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import CopilotChatSuggestionPill from "../CopilotChatSuggestionPill.vue";

// Vue 3.3 and 3.4 are inside the peer range but have no useId.
vi.mock("vue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue")>()),
  useId: undefined,
}));

describe("CopilotChatSuggestionPill on Vue without useId", () => {
  it("names a card by its title and describes it by its body", () => {
    const wrapper = mount(CopilotChatSuggestionPill, {
      props: { appearance: "card", description: "Outline the goals" },
      slots: { default: "Draft a brief" },
    });

    const button = wrapper.get("button");
    const titleId = button.attributes("aria-labelledby");
    const descriptionId = button.attributes("aria-describedby");
    expect(titleId).toBeTruthy();
    expect(descriptionId).not.toBe(titleId);
    expect(wrapper.get(`[id="${titleId}"]`).text()).toBe("Draft a brief");
    expect(wrapper.get(`[id="${descriptionId}"]`).text()).toBe(
      "Outline the goals",
    );
  });
});
