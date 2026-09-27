import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import type { Suggestion } from "@copilotkit/core";
import { CopilotChatSuggestionView } from "../CopilotChatSuggestionView";

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
    render(<CopilotChatSuggestionView suggestions={suggestions} />);
    const container = screen.getByTestId("copilot-suggestions");
    expect(container.getAttribute("data-appearance")).toBe("pills");
    expect(container.className).toContain("cpk:flex-nowrap");
    expect(
      screen
        .getAllByTestId("copilot-suggestion")
        .every((el) => el.getAttribute("data-slot") === "suggestion-pill"),
    ).toBe(true);
    expect(screen.queryByText("Turn the Q3 goals into a checklist")).toBeNull();
  });

  it("renders cards with the title as header and the message as body", () => {
    const onSelect = vi.fn();
    render(
      <CopilotChatSuggestionView
        suggestions={suggestions}
        appearance="cards"
        onSelectSuggestion={onSelect}
      />,
    );
    const container = screen.getByTestId("copilot-suggestions");
    expect(container.getAttribute("data-appearance")).toBe("cards");
    expect(container.className).toContain("cpk:grid");

    const cards = screen.getAllByTestId("copilot-suggestion");
    expect(cards[0]!.getAttribute("data-slot")).toBe("suggestion-card");
    expect(
      screen.getByText("Turn the Q3 goals into a checklist"),
    ).toBeDefined();
    // A message identical to the title isn't repeated as a body.
    expect(cards[1]!.textContent).toBe("Draft reply");

    fireEvent.click(cards[0]!);
    expect(onSelect).toHaveBeenCalledWith(suggestions[0], 0);
  });

  it("names each card by its title and describes it by its message", () => {
    render(
      <CopilotChatSuggestionView
        suggestions={suggestions}
        appearance="cards"
      />,
    );
    expect(
      screen.getByRole("button", {
        name: "Plan a launch",
        description: "Turn the Q3 goals into a checklist",
      }),
    ).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: "Draft reply" })
        .getAttribute("aria-describedby"),
    ).toBeNull();
  });
});
