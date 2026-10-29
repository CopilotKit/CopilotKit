import { afterEach, describe, expect, it, vi } from "vitest";
import { renderSurface } from "../../../__tests__/render";
import { standardUI } from "../../index";
import { mediaComponents } from "..";
import {
  imageByAlt,
  key,
  lightbox,
  renderInColumn,
  shownSrc,
  tick,
  ui,
} from "./helpers";

describe("mediaComponents", () => {
  it("is valid input for createGenerativeUI, with a description for every component", () => {
    const names = Object.keys(mediaComponents);
    expect(names).toEqual([
      "Image",
      "Icon",
      "Favicon",
      "Svg",
      "Video",
      "AudioPlayer",
      "HtmlView",
    ]);
    for (const name of names) {
      expect(ui.manifestComponents[name]!.description).toMatch(/\S/);
    }
  });
});

describe("Image", () => {
  it("renders an Image with its alt text, ratio and radius", () => {
    const view = renderInColumn({
      id: "i",
      component: "Image",
      url: "https://example.com/a.png",
      description: "pic",
      aspectRatio: "16/9",
      radius: "lg",
    });
    const image = imageByAlt(view.container, "pic")!;
    expect(image.getAttribute("src")).toBe("https://example.com/a.png");
    expect(image.style.aspectRatio).toBe("16/9");
    expect(image.style.width).toBe("100%");
    expect(image.style.borderRadius).toBe("var(--a2ui-radius-lg, 12px)");
    expect(image.hasAttribute("data-a2ui-lightbox-trigger")).toBe(true);
    // Without a wrapper, the host stays out of the layout.
    expect((image.parentElement as HTMLElement).style.display).toBe("contents");
  });

  it("reads the Image src from the data model", () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Image",
          url: { "@path": "/url" },
          description: "bound",
        },
      ],
      { url: "https://example.com/b.png" },
    );
    expect(imageByAlt(view.container, "bound")!.getAttribute("src")).toBe(
      "https://example.com/b.png",
    );
  });

  it("removes an Image that fails to load when hideOnFailure is set", () => {
    const view = renderInColumn(
      {
        id: "a",
        component: "Image",
        url: "https://example.com/broken.png",
        description: "hidden",
        hideOnFailure: true,
      },
      {
        id: "b",
        component: "Image",
        url: "https://example.com/broken.png",
        description: "kept",
      },
    );
    view.act(() => {
      imageByAlt(view.container, "hidden")!.dispatchEvent(new Event("error"));
      imageByAlt(view.container, "kept")!.dispatchEvent(new Event("error"));
    });
    expect(imageByAlt(view.container, "hidden")).toBeNull();
    expect(imageByAlt(view.container, "kept")).toBeInstanceOf(HTMLImageElement);
  });

  it("hides an Image together with its action overlay", () => {
    const view = renderInColumn({
      id: "a",
      component: "Image",
      url: "https://example.com/a.png",
      description: "Chart",
      actionOverlay: { label: "Open" },
      accessibility: { hidden: true, label: "Sales chart" },
    });
    const image = imageByAlt(view.container, "Chart")!;
    const wrapper = image.parentElement!;
    expect(wrapper.getAttribute("aria-hidden")).toBe("true");
    expect(wrapper.style.position).toBe("relative");
    expect(image.hasAttribute("aria-hidden")).toBe(false);
    expect(image.getAttribute("aria-label")).toBe("Sales chart");
    expect(wrapper.hasAttribute("aria-label")).toBe(false);
    expect(wrapper.querySelector("button")?.textContent?.trim()).toBe("Open");
  });

  it("Image actionOverlay dispatches its action", async () => {
    const view = renderInColumn({
      id: "a",
      component: "Image",
      url: "https://example.com/a.png",
      description: "A",
      actionOverlay: { label: "Save" },
      onOverlayClick: { event: { name: "save" } },
    });
    const save = view.container.querySelector("button")!;
    expect(save.textContent?.trim()).toBe("Save");
    save.click();
    await vi.waitFor(() => expect(view.forwardEvent).toHaveBeenCalledOnce());
    expect(view.forwardEvent.mock.calls[0]![0]).toMatchObject({ name: "save" });
  });

  it("Image hoverZoom and position apply", () => {
    const view = renderInColumn({
      id: "a",
      component: "Image",
      url: "https://example.com/a.png",
      description: "Z",
      hoverZoom: true,
      position: "top",
    });
    const image = imageByAlt(view.container, "Z")!;
    expect(image.style.objectPosition).toBe("top");
    expect(image.style.transition).toContain("transform");
    expect(image.parentElement!.style.overflow).toBe("hidden");
  });

  it("keeps the accessibility of the envelope on the fallback of a failed Image", () => {
    const view = renderInColumn({
      id: "a",
      component: "Image",
      url: "https://example.com/broken.png",
      description: "Chart",
      fallback: "No chart",
      accessibility: { label: "Sales chart", hidden: true },
    });
    view.act(() =>
      imageByAlt(view.container, "Chart")!.dispatchEvent(new Event("error")),
    );
    const fallback = [
      ...view.container.querySelectorAll<HTMLElement>("div"),
    ].find((element) => element.textContent?.trim() === "No chart")!;
    expect(fallback.getAttribute("role")).toBe("img");
    expect(fallback.style.minHeight).toBe("64px");
    expect(fallback.getAttribute("aria-label")).toBe("Sales chart");
    expect(fallback.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Favicon and HtmlView", () => {
  it("renders a Favicon from the host of the URL", () => {
    const view = renderInColumn(
      {
        id: "f",
        component: "Favicon",
        url: "https://copilotkit.ai/docs",
        alt: "ck",
      },
      { id: "g", component: "Favicon", url: "example.com" },
    );
    expect(imageByAlt(view.container, "ck")!.getAttribute("src")).toBe(
      "https://www.google.com/s2/favicons?domain=copilotkit.ai&sz=64",
    );
    expect(imageByAlt(view.container, "example.com")!.getAttribute("src")).toBe(
      "https://www.google.com/s2/favicons?domain=example.com&sz=64",
    );
  });

  it("renders HtmlView in a fully sandboxed iframe that runs no script", () => {
    const view = renderInColumn({
      id: "h",
      component: "HtmlView",
      html: "<b>hi</b><script>window.__htmlViewRan=1</script>",
      height: 100,
    });
    const frame = view.container.querySelector("iframe")!;
    expect(frame.getAttribute("title")).toBe("HTML content");
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("srcdoc")).toBe(
      "<b>hi</b><script>window.__htmlViewRan=1</script>",
    );
    expect(frame.style.height).toBe("100px");
    expect("__htmlViewRan" in window).toBe(false);
  });
});

describe("Image lightbox", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelector(".cdk-overlay-container")?.remove();
  });

  it("opens the image full-screen on click and closes on Escape", () => {
    const v = renderSurface(standardUI, [
      {
        id: "root",
        component: "Image",
        url: "https://example.com/a.png",
        description: "A",
      },
    ]);
    const img = v.container.querySelector<HTMLElement>('img[alt="A"]')!;
    expect(lightbox()).toBeNull();
    v.act(() => img.click());
    expect(shownSrc()).toBe("https://example.com/a.png");
    key("Escape");
    tick();
    expect(lightbox()).toBeNull();
  });

  it("does not open a lightbox when lightbox is false", () => {
    const v = renderSurface(standardUI, [
      {
        id: "root",
        component: "Image",
        url: "https://example.com/b.png",
        description: "B",
        lightbox: false,
      },
    ]);
    const img = v.container.querySelector<HTMLElement>('img[alt="B"]')!;
    expect(img.hasAttribute("data-a2ui-lightbox-trigger")).toBe(false);
    v.act(() => img.click());
    expect(lightbox()).toBeNull();
  });
});

describe("Image variant sizes", () => {
  it("gives the icon, avatar and smallFeature variants their sizes in pixels", () => {
    const view = renderSurface(standardUI, [
      { id: "root", component: "Column", children: ["i", "a", "s"] },
      {
        id: "i",
        component: "Image",
        url: "https://x.test/i.png",
        description: "icon",
        variant: "icon",
      },
      {
        id: "a",
        component: "Image",
        url: "https://x.test/a.png",
        description: "avatar",
        variant: "avatar",
      },
      {
        id: "s",
        component: "Image",
        url: "https://x.test/s.png",
        description: "small",
        variant: "smallFeature",
      },
    ]);
    const box = (alt: string) =>
      view.container.querySelector<HTMLImageElement>(`img[alt="${alt}"]`)!;
    const sized = (alt: string) => {
      // The size sits on the image or on its frame, as in React.
      const img = box(alt);
      return img.style.width ? img : (img.parentElement as HTMLElement);
    };
    expect(sized("icon").style.width).toBe("24px");
    expect(sized("avatar").style.height).toBe("40px");
    expect(sized("small").style.maxWidth).toBe("160px");
  });
});
