import { afterEach, describe, expect, it, vi } from "vitest";
import { renderSurface } from "../../../__tests__/render";
import { compositeComponents } from "../index";
import { ui } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
  document.querySelector(".cdk-overlay-container")?.remove();
});

describe("compositeComponents", () => {
  it("is valid input for createGenerativeUI, with a description for every component", () => {
    expect(Object.keys(compositeComponents)).toEqual([
      "LinkCard",
      "Citation",
      "FollowUp",
      "EntityCard",
      "ImageGrid",
    ]);
    for (const name of Object.keys(compositeComponents)) {
      expect(ui.manifestComponents[name]?.description).toMatch(/\S/);
    }
    expect(ui.manifestComponents.FollowUp?.events).toHaveProperty("onFollowUp");
  });
});

describe("standard catalog: composites", () => {
  it("LinkCard renders a new-tab link with domain, title and description", () => {
    const v = renderSurface(ui, [
      {
        id: "root",
        component: "LinkCard",
        href: "https://docs.copilotkit.ai/a2ui",
        title: "A2UI markdown mode",
        description: "Render surfaces from fences.",
      },
    ]);
    const card = v.container.querySelector("a[data-a2ui-link-card]")!;
    expect(card.getAttribute("href")).toBe("https://docs.copilotkit.ai/a2ui");
    expect(card.getAttribute("target")).toBe("_blank");
    expect(card.getAttribute("rel")).toBe("noopener noreferrer");
    expect(card.textContent).toContain("docs.copilotkit.ai");
    expect(card.textContent).toContain("A2UI markdown mode");
    expect(card.textContent).toContain("Render surfaces from fences.");
    expect(card.querySelector("img")?.getAttribute("src")).toContain(
      "favicons?domain=docs.copilotkit.ai",
    );
  });

  it("LinkCard with a bound onClick is a button that sends the event", async () => {
    const v = renderSurface(ui, [
      {
        id: "root",
        component: "LinkCard",
        href: "https://docs.copilotkit.ai",
        title: "Docs",
        onClick: { event: { name: "open_docs" } },
      },
    ]);
    expect(v.container.querySelector("a")).toBeNull();
    v.act(() =>
      v.container
        .querySelector<HTMLButtonElement>("button[data-a2ui-link-card]")!
        .click(),
    );
    await vi.waitFor(() => expect(v.forwardEvent).toHaveBeenCalled());
    expect(v.forwardEvent.mock.calls[0]?.[0].name).toBe("open_docs");
  });
});
