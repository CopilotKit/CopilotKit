import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/vue";
import type { Suggestion } from "@copilotkit/core";
import CopilotChatSuggestionView from "../CopilotChatSuggestionView.vue";

const suggestions: Suggestion[] = [
  {
    title: "Plan a launch",
    message: "Turn the Q3 goals into a checklist",
    isLoading: false,
  },
  { title: "Draft reply", message: "Draft reply", isLoading: false },
];

describe("CopilotChatSuggestionView appearance", () => {
  it("renders pills in a single row by default", () => {
    render(CopilotChatSuggestionView, { props: { suggestions } });
    const container = screen.getByTestId("copilot-chat-suggestion-view");
    expect(container.getAttribute("data-appearance")).toBe("pills");
    expect(container.className).toContain("cpk:flex-nowrap");
    expect(
      screen
        .getAllByTestId("copilot-chat-suggestion-pill")
        .every((el) => el.getAttribute("data-slot") === "suggestion-pill"),
    ).toBe(true);
    expect(screen.queryByText("Turn the Q3 goals into a checklist")).toBeNull();
  });

  it("renders cards with the title as header and the message as body", async () => {
    const onSelect = vi.fn();
    render(CopilotChatSuggestionView, {
      props: {
        suggestions,
        appearance: "cards",
        "onSelect-suggestion": onSelect,
      },
    });
    const container = screen.getByTestId("copilot-chat-suggestion-view");
    expect(container.getAttribute("data-appearance")).toBe("cards");
    expect(container.className).toContain("cpk:grid");

    const cards = screen.getAllByTestId("copilot-chat-suggestion-pill");
    expect(cards[0]!.getAttribute("data-slot")).toBe("suggestion-card");
    expect(
      screen.getByText("Turn the Q3 goals into a checklist"),
    ).toBeDefined();
    // A message identical to the title isn't repeated as a body.
    expect(cards[1]!.textContent?.trim()).toBe("Draft reply");

    await fireEvent.click(cards[0]!);
    expect(onSelect).toHaveBeenCalledWith(suggestions[0], 0);
  });
});
