import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `SelectorCard` navigates with the App Router. Outside a Next app there is no
// router context, so `useRouter()` throws — stub it.
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { SelectorCard } from "@/shell/layout/selector-card";
import { LayoutPreferencesProvider } from "@/shell/layout/layout-preferences";
import { allSkins } from "@/shell/registry";

/** Radix opens its trigger on Enter as well as pointerdown; the keyboard path is
 *  the reliable one in jsdom, which has no real pointer events. */
function openMenu() {
  const trigger = screen.getByTestId("skin-selector-trigger");
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
}

describe("SelectorCard", () => {
  beforeEach(() => {
    push.mockClear();
    // The card writes layout preferences now, so isolate storage between cases.
    window.localStorage.clear();
  });

  it("shows the active skin on the trigger, and no other skin's brand", () => {
    render(<SelectorCard activeId="banking" />);

    const trigger = screen.getByTestId("skin-selector-trigger");
    expect(trigger.textContent).toContain("Northwind Finance");
    // The point of the dropdown: cost stays flat as skins are added, so the other
    // brands are not rendered until it opens.
    expect(trigger.textContent).not.toContain("Aeronova");
  });

  it("lists every registered skin once opened", () => {
    render(<SelectorCard activeId="banking" />);
    openMenu();

    for (const skin of allSkins()) {
      expect(screen.getByTestId(`skin-option-${skin.id}`)).toBeDefined();
    }
  });

  it("marks the active skin as the current page", () => {
    render(<SelectorCard activeId="banking" />);
    openMenu();

    expect(
      screen.getByTestId("skin-option-banking").getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByTestId("skin-option-airline").getAttribute("aria-current"),
    ).toBeNull();
  });

  it("navigates to the chosen skin's route", () => {
    render(<SelectorCard activeId="banking" />);
    openMenu();

    fireEvent.click(screen.getByTestId("skin-option-airline"));
    expect(push).toHaveBeenCalledWith("/airline");
  });

  it("offers the swap-sides control beside the switcher, labelled by current side", () => {
    // Both controls are shell concerns, which is why this one moved out of the chat
    // header. Rendered without a LayoutPreferencesProvider here, so it reads the
    // hook's inert defaults (side "left") rather than throwing.
    render(<SelectorCard activeId="banking" />);

    const swap = screen.getByTestId("swap-sides");
    expect(swap.getAttribute("aria-label")).toBe("Move assistant to the right");
  });

  it("reflects the persisted side in the swap control's label", () => {
    render(
      <LayoutPreferencesProvider>
        <SelectorCard activeId="banking" />
      </LayoutPreferencesProvider>,
    );

    const swap = screen.getByTestId("swap-sides");
    expect(swap.getAttribute("aria-label")).toBe("Move assistant to the right");

    fireEvent.click(swap);
    expect(screen.getByTestId("swap-sides").getAttribute("aria-label")).toBe(
      "Move assistant to the left",
    );
  });

  it("hides the assistant from the card, not the chat header", () => {
    render(
      <LayoutPreferencesProvider>
        <SelectorCard activeId="banking" />
      </LayoutPreferencesProvider>,
    );

    fireEvent.click(screen.getByTestId("sidebar-close"));

    // Collapsing is persisted, so it survives a reload — and it hides this card
    // along with the chat, which is why the control belongs beside what it hides.
    expect(
      JSON.parse(window.localStorage.getItem("nw-layout-prefs") ?? "{}")
        .sidebarOpen,
    ).toBe(false);
  });

  it("carries the shell's fixed-radius card class", () => {
    render(<SelectorCard activeId="banking" />);
    // The 12px radius is shell-owned and must not vary per skin, so the card opts
    // into `.nw-panel-card` rather than a themed radius utility.
    expect(screen.getByTestId("skin-selector").className).toContain(
      "nw-panel-card",
    );
  });
});
