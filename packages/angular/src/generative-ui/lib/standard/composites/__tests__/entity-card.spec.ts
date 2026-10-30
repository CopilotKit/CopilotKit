import { afterEach, describe, expect, it, vi } from "vitest";
import { renderSurface } from "../../../__tests__/render";
import { buttonNamed } from "../../../__tests__/dom";
import { ui } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
  document.querySelector(".cdk-overlay-container")?.remove();
});

describe("standard catalog: composites", () => {
  it("EntityCard renders title, meta, badge, rating and action buttons", async () => {
    const v = renderSurface(ui, [
      {
        id: "root",
        component: "EntityCard",
        title: "Café Central",
        subtitle: "Coffee house",
        description: "Grand historic café.",
        meta: "Open until 22:00",
        badge: { label: "Popular", color: "success" },
        rating: 4.5,
        ratingCount: 1200,
        actions: [{ label: "Pick" }],
        onAction: { event: { name: "pick" } },
      },
    ]);
    const card = v.container.querySelector<HTMLElement>(
      "[data-a2ui-entity-card]",
    )!;
    expect(card.textContent).toContain("Café Central");
    expect(card.textContent).toContain("Open until 22:00");
    expect(card.textContent).toContain("Popular");
    expect(card.querySelector("[aria-label='4.5 out of 5']")).not.toBeNull();
    expect(card.textContent).toContain("(1200)");
    expect(card.getAttribute("role")).toBeNull();
    v.act(() => buttonNamed(card, "Pick")!.click());
    await vi.waitFor(() => expect(v.forwardEvent).toHaveBeenCalledTimes(1));
    const event = v.forwardEvent.mock.calls[0]![0];
    expect(event.name).toBe("pick");
    expect(event.context).toMatchObject({ label: "Pick" });
  });

  it("EntityCard with href opens the page and a button with href opens its URL", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const v = renderSurface(ui, [
      {
        id: "root",
        component: "EntityCard",
        title: "Sacher",
        href: "https://sacher.example",
        layout: "horizontal",
        image: "https://sacher.example/img.png",
        actions: [{ label: "Directions", href: "https://maps.example" }],
      },
    ]);
    const card = v.container.querySelector<HTMLElement>(
      "[data-a2ui-entity-card]",
    )!;
    expect(card.getAttribute("role")).toBe("link");
    expect(card.getAttribute("tabindex")).toBe("0");
    expect(card.style.flexDirection).toBe("row");
    expect(card.querySelector("img")?.getAttribute("alt")).toBe("Sacher");
    v.act(() => buttonNamed(card, "Directions")!.click());
    expect(open).toHaveBeenLastCalledWith(
      "https://maps.example",
      "_blank",
      "noopener,noreferrer",
    );
    v.act(() => card.click());
    expect(open).toHaveBeenLastCalledWith(
      "https://sacher.example",
      "_blank",
      "noopener,noreferrer",
    );
    v.act(() =>
      card.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(open).toHaveBeenCalledTimes(3);
    expect(v.forwardEvent).not.toHaveBeenCalled();
  });
});
