import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import type { Suggestion } from "@copilotkit/core";

import { CopilotChatSuggestionView } from "../copilot-chat-suggestion-view";

const suggestions: Suggestion[] = [
  {
    title: "Plan a launch",
    message: "Turn the Q3 goals into a checklist",
    isLoading: false,
  },
  { title: "Draft reply", message: "Draft reply", isLoading: false },
];

describe("CopilotChatSuggestionView", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [CopilotChatSuggestionView] });
  });

  const render = (appearance?: "pills" | "cards") => {
    const fixture = TestBed.createComponent(CopilotChatSuggestionView);
    fixture.componentRef.setInput("suggestions", suggestions);
    if (appearance) fixture.componentRef.setInput("appearance", appearance);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it("renders pills in a single scrollable row by default", () => {
    const element = render();
    const container = element.querySelector(
      '[data-testid="copilot-suggestions"]',
    )!;
    expect(container.className).toContain("cpk:overflow-x-auto");
    expect(
      element.querySelectorAll('[data-slot="suggestion-pill"]'),
    ).toHaveLength(2);
  });

  it("renders cards in an equal-height two-column grid with the message as body", () => {
    const element = render("cards");
    const container = element.querySelector(
      '[data-testid="copilot-suggestions"]',
    )!;
    expect(container.className).toContain("cpk:grid");
    expect(container.className).toContain("cpk:grid-cols-2");
    expect(container.className).toContain("cpk:auto-rows-fr");

    // Cards keep the pill slot name; data-appearance tells them apart.
    const cards = element.querySelectorAll(
      '[data-slot="suggestion-pill"][data-appearance="card"]',
    );
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain(
      "Turn the Q3 goals into a checklist",
    );
    // A message that just repeats the title isn't shown twice.
    expect(cards[1]!.querySelector(".cpk\\:line-clamp-2")).toBeNull();
  });

  it("names each card by its title and describes it with the message", () => {
    const element = render("cards");
    const [card, titleOnly] = Array.from(
      element.querySelectorAll<HTMLElement>('button[data-appearance="card"]'),
    );
    const byId = (id: string | null) =>
      id ? element.querySelector(`[id="${id}"]`)?.textContent?.trim() : null;

    expect(byId(card!.getAttribute("aria-labelledby"))).toBe("Plan a launch");
    expect(byId(card!.getAttribute("aria-describedby"))).toBe(
      "Turn the Q3 goals into a checklist",
    );
    expect(titleOnly!.hasAttribute("aria-describedby")).toBe(false);
  });
});
