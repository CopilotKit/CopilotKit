import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { compositeComponents } from "../composites";
import { standardUI } from "../index";
import { renderSurface } from "./render";

afterEach(() => {
  vi.restoreAllMocks();
});

const render = (
  ...args: Parameters<typeof renderSurface> extends [unknown, ...infer Rest]
    ? Rest
    : never
) => renderSurface(standardUI, ...args);

const lightbox = () => document.querySelector("[data-a2ui-lightbox]");
const shownSrc = () => lightbox()?.querySelector("img")?.getAttribute("src");

describe("compositeComponents", () => {
  it("is valid input for createGenerativeUI, with a description for every component", () => {
    const names = Object.keys(compositeComponents);
    expect(names).toEqual([
      "LinkCard",
      "Citation",
      "FollowUp",
      "EntityCard",
      "ImageGrid",
    ]);
    for (const name of names) {
      expect(standardUI.manifestComponents[name].description).toMatch(/\S/);
    }
    expect(standardUI.manifestComponents.FollowUp.events).toHaveProperty(
      "onFollowUp",
    );
  });
});

describe("standard catalog: composites", () => {
  it("LinkCard renders a new-tab link with domain, title and description", async () => {
    const v = render([
      {
        id: "root",
        component: "LinkCard",
        href: "https://docs.copilotkit.ai/a2ui",
        title: "A2UI markdown mode",
        description: "Render surfaces from fences.",
      },
    ]);
    const card = (await v.findByText("A2UI markdown mode")).closest("a")!;
    expect(card.getAttribute("href")).toBe("https://docs.copilotkit.ai/a2ui");
    expect(card.getAttribute("target")).toBe("_blank");
    expect(v.getByText("docs.copilotkit.ai")).not.toBeNull();
    expect(v.getByText("Render surfaces from fences.")).not.toBeNull();
  });

  it("LinkCard with a bound onClick is a button that sends the event", async () => {
    const v = render([
      {
        id: "root",
        component: "LinkCard",
        href: "https://docs.copilotkit.ai",
        title: "Docs",
        onClick: { event: { name: "open_docs" } },
      },
    ]);
    fireEvent.click(await v.findByRole("button", { name: /Docs/ }));
    expect(v.forwardEvent.mock.calls[0][0].name).toBe("open_docs");
  });

  it("Citation shows its source on click", async () => {
    const v = render([
      { id: "root", component: "Row", children: ["t", "c"] },
      {
        id: "t",
        component: "Text",
        text: "Vienna has 1.9M people",
        inline: true,
      },
      {
        id: "c",
        component: "Citation",
        index: 2,
        title: "Vienna population",
        url: "https://en.wikipedia.org/wiki/Vienna",
        snippet: "1.9 million inhabitants",
      },
    ]);
    const marker = await v.findByRole("button", { name: "Source 2" });
    expect(v.queryByText("Vienna population")).toBeNull();
    fireEvent.click(marker);
    expect(v.getByText("Vienna population")).not.toBeNull();
    expect(v.getByText("1.9 million inhabitants")).not.toBeNull();
    expect(v.getByText("Open source").getAttribute("href")).toBe(
      "https://en.wikipedia.org/wiki/Vienna",
    );
  });

  it("FollowUp dispatches the item's message as an action", async () => {
    const v = render([
      {
        id: "root",
        component: "FollowUp",
        title: "Next",
        items: [
          "Cheaper version",
          { label: "Luxury", message: "Make it luxury" },
        ],
        onFollowUp: { event: { name: "follow_up" } },
      },
    ]);
    fireEvent.click(await v.findByRole("button", { name: "Luxury" }));
    expect(v.forwardEvent).toHaveBeenCalledTimes(1);
    const event = v.forwardEvent.mock.calls[0][0];
    expect(event.name).toBe("follow_up");
    expect(event.context).toMatchObject({ message: "Make it luxury" });
  });

  it("EntityCard renders title, meta, badge, rating and action buttons", async () => {
    const v = render([
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
    expect(await v.findByText("Café Central")).not.toBeNull();
    expect(v.getByText("Open until 22:00")).not.toBeNull();
    expect(v.getByText("Popular")).not.toBeNull();
    expect(v.getByLabelText("4.5 out of 5")).not.toBeNull();
    fireEvent.click(v.getByRole("button", { name: "Pick" }));
    const event = v.forwardEvent.mock.calls[0][0];
    expect(event.name).toBe("pick");
    expect(event.context).toMatchObject({ label: "Pick" });
  });

  it("EntityCard with href opens the page and a button with href opens its URL", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const v = render([
      {
        id: "root",
        component: "EntityCard",
        title: "Sacher",
        href: "https://sacher.example",
        actions: [{ label: "Directions", href: "https://maps.example" }],
      },
    ]);
    fireEvent.click(await v.findByRole("button", { name: "Directions" }));
    expect(open).toHaveBeenLastCalledWith(
      "https://maps.example",
      "_blank",
      "noopener,noreferrer",
    );
    fireEvent.click(v.getByRole("link"));
    expect(open).toHaveBeenLastCalledWith(
      "https://sacher.example",
      "_blank",
      "noopener,noreferrer",
    );
    expect(v.forwardEvent).not.toHaveBeenCalled();
  });

  it("ImageGrid renders every image and opens the lightbox on click", async () => {
    const v = render([
      {
        id: "root",
        component: "ImageGrid",
        layout: "bento",
        images: [
          { src: "https://example.com/1.png", alt: "one" },
          { src: "https://example.com/2.png", alt: "two", caption: "Two" },
          { src: "https://example.com/3.png", alt: "three" },
        ],
      },
    ]);
    const first = await v.findByAltText("one");
    expect(v.getAllByRole("img")).toHaveLength(3);
    expect(v.getByText("Two")).not.toBeNull();
    fireEvent.click(first);
    expect(shownSrc()).toBe("https://example.com/1.png");
    fireEvent.click(lightbox()!);
    expect(lightbox()).toBeNull();
  });

  it("ImageGrid lightbox walks through all images with the arrows and keys", async () => {
    const v = render([
      {
        id: "root",
        component: "ImageGrid",
        images: [
          { src: "https://example.com/1.png", alt: "one" },
          { src: "https://example.com/2.png", alt: "two" },
          { src: "https://example.com/3.png", alt: "three" },
        ],
      },
    ]);
    fireEvent.click(await v.findByAltText("two"));
    expect(shownSrc()).toBe("https://example.com/2.png");
    expect(lightbox()!.textContent).toContain("2 / 3");
    fireEvent.click(
      lightbox()!.querySelector("[data-a2ui-lightbox-arrow=next]")!,
    );
    expect(shownSrc()).toBe("https://example.com/3.png");
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(shownSrc()).toBe("https://example.com/1.png");
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(shownSrc()).toBe("https://example.com/3.png");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(lightbox()).toBeNull();
  });

  it("CarouselMediaItem opens a lightbox over every slide of its carousel", async () => {
    const v = render([
      { id: "root", component: "Carousel", children: ["a", "b", "c"] },
      {
        id: "a",
        component: "CarouselMediaItem",
        media: "https://example.com/a.png",
        alt: "A",
      },
      {
        id: "b",
        component: "CarouselMediaItem",
        media: "https://example.com/b.png",
        alt: "B",
      },
      {
        id: "c",
        component: "CarouselMediaItem",
        media: "https://example.com/c.png",
        alt: "C",
      },
    ]);
    fireEvent.click(await v.findByAltText("B"));
    expect(shownSrc()).toBe("https://example.com/b.png");
    expect(lightbox()!.textContent).toContain("2 / 3");
    fireEvent.click(
      lightbox()!.querySelector("[data-a2ui-lightbox-arrow=next]")!,
    );
    expect(shownSrc()).toBe("https://example.com/c.png");
  });

  it("CarouselMediaItem with href opens the URL instead of the lightbox", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const v = render([
      { id: "root", component: "Carousel", children: ["a"] },
      {
        id: "a",
        component: "CarouselMediaItem",
        media: "https://example.com/a.png",
        alt: "A",
        href: "https://copilotkit.ai",
      },
    ]);
    fireEvent.click(await v.findByAltText("A"));
    expect(open).toHaveBeenCalledWith(
      "https://copilotkit.ai",
      "_blank",
      "noopener,noreferrer",
    );
    expect(lightbox()).toBeNull();
  });

  it("CarouselMediaItem renders its image at the size's width", async () => {
    const v = render([
      { id: "root", component: "Carousel", children: ["a"] },
      {
        id: "a",
        component: "CarouselMediaItem",
        media: "https://example.com/a.png",
        alt: "slide",
        size: "sm",
        children: ["t"],
      },
      { id: "t", component: "Caption", text: "Slide A" },
    ]);
    const img = await v.findByAltText("slide");
    expect((img.parentElement as HTMLElement).style.width).toBe("160px");
    expect(v.getByText("Slide A")).not.toBeNull();
  });
});

describe("Image lightbox and Popover trigger", () => {
  it("opens the image full-screen on click and closes on Escape", async () => {
    const v = render([
      {
        id: "root",
        component: "Image",
        src: "https://example.com/a.png",
        alt: "A",
      },
    ]);
    const img = await v.findByAltText("A");
    expect(lightbox()).toBeNull();
    fireEvent.click(img);
    expect(shownSrc()).toBe("https://example.com/a.png");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(lightbox()).toBeNull();
  });

  it("does not open a lightbox when lightbox is false", async () => {
    const v = render([
      {
        id: "root",
        component: "Image",
        src: "https://example.com/b.png",
        alt: "B",
        lightbox: false,
      },
    ]);
    fireEvent.click(await v.findByAltText("B"));
    expect(lightbox()).toBeNull();
  });

  it("toggles a Popover when its trigger is a Button", async () => {
    const v = render([
      { id: "root", component: "Popover", children: ["t", "c"] },
      { id: "t", component: "PopoverTrigger", children: ["b"] },
      { id: "b", component: "Button", label: "Open", variant: "outline" },
      { id: "c", component: "PopoverContent", children: ["x"] },
      { id: "x", component: "Text", text: "Popover body" },
    ]);
    await v.findByText("Open");
    // The trigger wrapper is a button too, so target the inner <button>.
    const button = v.container.querySelector(
      "[data-a2ui-popover-trigger] button",
    ) as HTMLElement;
    expect(v.queryByText("Popover body")).toBeNull();
    fireEvent.click(button);
    expect(v.getByText("Popover body")).not.toBeNull();
    fireEvent.click(button);
    expect(v.queryByText("Popover body")).toBeNull();
  });
});

describe("Button and Pressable client-side verbs", () => {
  it("Button with href opens the URL in a new tab and does not dispatch", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const v = render([
      {
        id: "root",
        component: "Button",
        label: "Docs",
        href: "https://docs.copilotkit.ai",
        onClick: { event: { name: "never" } },
      },
    ]);
    fireEvent.click(await v.findByRole("button", { name: "Docs" }));
    expect(open).toHaveBeenCalledWith(
      "https://docs.copilotkit.ai",
      "_blank",
      "noopener,noreferrer",
    );
    expect(v.forwardEvent).not.toHaveBeenCalled();
  });

  it("Button with href ignores unsafe schemes", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const v = render([
      {
        id: "root",
        component: "Button",
        label: "Bad",
        href: "javascript:alert(1)",
      },
    ]);
    fireEvent.click(await v.findByRole("button", { name: "Bad" }));
    expect(open).not.toHaveBeenCalled();
  });

  it("Button with copy writes to the clipboard and shows a check", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const v = render([
      { id: "root", component: "Button", label: "Copy code", copy: "ABC-123" },
    ]);
    const button = await v.findByRole("button", { name: "Copy code" });
    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledWith("ABC-123");
    await vi.waitFor(() =>
      expect(button.hasAttribute("data-a2ui-copied")).toBe(true),
    );
  });

  it("Pressable with href opens the URL", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const v = render([
      {
        id: "root",
        component: "Pressable",
        href: "https://copilotkit.ai",
        children: ["t"],
      },
      { id: "t", component: "Text", text: "Go" },
    ]);
    fireEvent.click((await v.findByText("Go")).closest("[role=button]")!);
    expect(open).toHaveBeenCalledTimes(1);
  });
});
