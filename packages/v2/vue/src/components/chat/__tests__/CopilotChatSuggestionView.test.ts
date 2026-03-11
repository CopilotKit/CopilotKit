import { describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { mount } from "@vue/test-utils";
import type { Suggestion } from "@copilotkitnext/core";
import CopilotChatSuggestionView from "../CopilotChatSuggestionView.vue";

const suggestions: Suggestion[] = [
  { title: "Suggestion 1", message: "Message 1", isLoading: false },
  { title: "Suggestion 2", message: "Message 2", isLoading: false },
  { title: "Suggestion 3", message: "Message 3", isLoading: true },
];

describe("CopilotChatSuggestionView", () => {
  it("renders one pill per suggestion", () => {
    const wrapper = mount(CopilotChatSuggestionView, {
      props: {
        suggestions,
      },
    });

    const pills = wrapper.findAll("[data-testid='copilot-chat-suggestion-pill']");
    expect(pills).toHaveLength(3);
    expect(wrapper.text()).toContain("Suggestion 1");
    expect(wrapper.text()).toContain("Suggestion 2");
    expect(wrapper.text()).toContain("Suggestion 3");
  });

  it("merges loading indexes with suggestion-level loading state", () => {
    const wrapper = mount(CopilotChatSuggestionView, {
      props: {
        suggestions,
        loadingIndexes: [1],
      },
    });

    const disabledButtons = wrapper.findAll("button[disabled]");
    expect(disabledButtons).toHaveLength(2);
  });

  it("emits select-suggestion exactly once with suggestion and index", async () => {
    const onSelectSuggestion = vi.fn();
    const wrapper = mount(CopilotChatSuggestionView, {
      props: {
        suggestions,
        onSelectSuggestion,
      },
    });

    const buttons = wrapper.findAll("button[data-testid='copilot-chat-suggestion-pill']");
    await buttons[1]?.trigger("click");

    expect(onSelectSuggestion).toHaveBeenCalledTimes(1);
    expect(onSelectSuggestion).toHaveBeenCalledWith(suggestions[1], 1);
    expect(wrapper.emitted("select-suggestion")?.[0]).toEqual([suggestions[1], 1]);
  });

  it("supports custom suggestion slot and onSelect forwarding", async () => {
    const onSelectSuggestion = vi.fn();
    const wrapper = mount(CopilotChatSuggestionView, {
      props: {
        suggestions,
        onSelectSuggestion,
      },
      slots: {
        suggestion: ({ suggestion, index, isLoading, onSelect }) =>
          h(
            "button",
            {
              "data-testid": `custom-pill-${index as number}`,
              disabled: isLoading as boolean,
              onClick: onSelect as () => void,
            },
            `[${(suggestion as Suggestion).title}]`,
          ),
      },
    });

    const customButtons = wrapper.findAll("[data-testid^='custom-pill-']");
    expect(customButtons).toHaveLength(3);
    await customButtons[0]?.trigger("click");
    expect(onSelectSuggestion).toHaveBeenCalledTimes(1);
    expect(onSelectSuggestion).toHaveBeenCalledWith(suggestions[0], 0);
  });
});
