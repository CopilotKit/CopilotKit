import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderStandard } from "./standard-test-utils";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("standard catalog: props added for ChatGPT parity", () => {
  it("TableRow renders its label as a row header cell with labelColSpan", async () => {
    const v = renderStandard([
      { id: "root", component: "Table", children: ["r"] },
      {
        id: "r",
        component: "TableRow",
        label: "Day 1",
        labelColSpan: 2,
        children: ["c"],
      },
      { id: "c", component: "TableCell", text: "€80" },
    ]);
    const th = (await v.findByText("Day 1")) as HTMLTableCellElement;
    expect(th.tagName).toBe("TH");
    expect(th.getAttribute("scope")).toBe("row");
    expect(th.colSpan).toBe(2);
  });

  it("ListItem disabled renders at half opacity and ignores its action", async () => {
    const onAction = vi.fn();
    const v = renderStandard(
      [
        { id: "root", component: "List", children: ["i"] },
        {
          id: "i",
          component: "ListItem",
          label: "Sold out",
          disabled: true,
          action: { event: { name: "pick" } },
        },
      ],
      undefined,
      onAction,
    );
    const label = await v.findByText("Sold out");
    const li = label.closest("li") as HTMLElement;
    expect(li.getAttribute("aria-disabled")).toBe("true");
    expect(li.style.opacity).toBe("0.5");
    expect(li.querySelector("button")).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("Image shows the fallback text when the image fails to load", async () => {
    const v = renderStandard([
      {
        id: "root",
        component: "Image",
        src: "https://example.com/missing.png",
        alt: "Missing",
        fallback: "Image unavailable",
      },
    ]);
    const img = await v.findByAltText("Missing");
    fireEvent.error(img);
    expect(await v.findByText("Image unavailable")).not.toBeNull();
  });

  it("Image actionOverlay dispatches its action", async () => {
    const onAction = vi.fn();
    const v = renderStandard(
      [
        {
          id: "root",
          component: "Image",
          src: "https://example.com/a.png",
          alt: "A",
          actionOverlay: { label: "Save", action: { event: { name: "save" } } },
        },
      ],
      undefined,
      onAction,
    );
    fireEvent.click(await v.findByRole("button", { name: "Save" }));
    expect(onAction.mock.calls[0][0].userAction.name).toBe("save");
  });

  it("YouTube shows a poster first and loads the player on click", async () => {
    const v = renderStandard([
      {
        id: "root",
        component: "YouTube",
        videoId: "dQw4w9WgXcQ",
        title: "Clip",
      },
    ]);
    const play = await v.findByRole("button", { name: "Play Clip" });
    expect(v.container.querySelector("iframe")).toBeNull();
    fireEvent.click(play);
    const iframe = v.container.querySelector("iframe")!;
    expect(iframe.getAttribute("src")).toContain("dQw4w9WgXcQ");
    expect(iframe.getAttribute("src")).toContain("autoplay=1");
  });

  it("Carousel renders previous/next arrows with custom labels", async () => {
    const v = renderStandard([
      {
        id: "root",
        component: "Carousel",
        previousLabel: "Back",
        nextLabel: "Forward",
        ariaLabel: "Slides",
        children: ["a", "b"],
      },
      { id: "a", component: "CarouselItem", children: ["ta"] },
      { id: "ta", component: "Text", text: "One" },
      { id: "b", component: "CarouselItem", children: ["tb"] },
      { id: "tb", component: "Text", text: "Two" },
    ]);
    await v.findByText("One");
    expect(v.getByRole("button", { name: "Back" })).not.toBeNull();
    expect(v.getByRole("button", { name: "Forward" })).not.toBeNull();
    expect(v.getByRole("region", { name: "Slides" })).not.toBeNull();
  });

  it("layout props: flush removes padding, disableAutoSpacing removes the default gap, role is applied", async () => {
    const v = renderStandard([
      { id: "root", component: "Column", children: ["c"] },
      {
        id: "c",
        component: "Card",
        flush: true,
        disableAutoSpacing: true,
        role: "group",
        children: ["t"],
      },
      { id: "t", component: "Text", text: "Inside" },
    ]);
    const card = (await v.findByText("Inside")).parentElement as HTMLElement;
    expect(card.getAttribute("role")).toBe("group");
    expect(["0", "0px"]).toContain(card.style.padding);
    expect(["0", "0px"]).toContain(card.style.gap);
  });

  it("Card size and shadowStyle presets apply", async () => {
    const v = renderStandard([
      {
        id: "root",
        component: "Card",
        size: "sm",
        shadowStyle: "md",
        children: ["t"],
      },
      { id: "t", component: "Text", text: "Small" },
    ]);
    const card = (await v.findByText("Small")).parentElement as HTMLElement;
    expect(card.style.padding).toBe("calc(var(--spacing, 0.25rem) * 2)");
    expect(card.style.boxShadow).toContain("--a2ui-shadow-md");
  });

  it("Text fontSize, lineHeight and minLines", async () => {
    const v = renderStandard([
      {
        id: "root",
        component: "Text",
        text: "Tall",
        fontSize: 18,
        lineHeight: 1.2,
        minLines: 3,
      },
    ]);
    const el = (await v.findByText("Tall")) as HTMLElement;
    expect(el.style.fontSize).toBe("18px");
    expect(el.style.lineHeight).toBe("1.2");
    expect(el.style.minHeight).toBe("4.5em");
  });

  it("Popover sideOffset moves the content", async () => {
    const v = renderStandard([
      { id: "root", component: "Popover", children: ["t", "c"] },
      { id: "t", component: "PopoverTrigger", block: true, children: ["b"] },
      { id: "b", component: "Text", text: "Toggle" },
      { id: "c", component: "PopoverContent", sideOffset: 12, children: ["x"] },
      { id: "x", component: "Text", text: "Body" },
    ]);
    const trigger = (await v.findByText("Toggle")).closest(
      "[data-a2ui-popover-trigger]",
    ) as HTMLElement;
    expect(trigger.style.width).toBe("100%");
    fireEvent.click(trigger);
    const dialog = await v.findByRole("dialog");
    expect(dialog.style.marginTop).toBe("12px");
  });

  it("onVisible dispatches once when the container becomes visible", async () => {
    let callback:
      | ((entries: Array<{ isIntersecting: boolean }>) => void)
      | null = null;
    class FakeObserver {
      constructor(cb: typeof callback) {
        callback = cb;
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const onAction = vi.fn();
    const v = renderStandard(
      [
        {
          id: "root",
          component: "Column",
          onVisible: { event: { name: "seen" } },
          children: ["t"],
        },
        { id: "t", component: "Text", text: "Hi" },
      ],
      undefined,
      onAction,
    );
    await v.findByText("Hi");
    await waitFor(() => expect(callback).not.toBeNull());
    callback!([{ isIntersecting: true }]);
    callback!([{ isIntersecting: true }]);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][0].userAction.name).toBe("seen");
    vi.unstubAllGlobals();
  });
});
