import { fireEvent } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import { renderSurface } from "../../../__tests__/helpers/render-surface";
import {
  imageByAlt,
  lightbox,
  renderInColumn,
  shownSrc,
  ui,
  updateDataModel,
} from "./helpers";

// The Image cases of Angular's `standard/media/__tests__/image.spec.ts` that
// React's suites do not have. The cases both have are in `media.test.ts`
// and `data-media-parity.test.ts`.

const pressEscape = () => fireEvent.keyDown(document, { key: "Escape" });

describe("Image", () => {
  it("shows a new url of a failed Image, and an error of an older src does not fail it", async () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Image",
          url: { "@path": "/url" },
          description: "Photo",
          fallback: "No photo",
        },
      ],
      { url: "https://example.com/a.png" },
    );
    await fireEvent.error(await view.findByAltText("Photo"));
    expect(imageByAlt(view.container, "Photo")).toBeNull();
    expect(view.container.textContent).toContain("No photo");

    await view.update(updateDataModel("/url", "https://example.com/b.png"));
    const image = imageByAlt(view.container, "Photo")!;
    expect(image.getAttribute("src")).toBe("https://example.com/b.png");

    // A late error of the previous src, after the url changed.
    image.setAttribute("src", "https://example.com/a.png");
    await fireEvent.error(image);
    image.setAttribute("src", "https://example.com/b.png");
    expect(imageByAlt(view.container, "Photo")).toBe(image);
  });

  it("keeps the accessibility of the envelope on the fallback of a failed Image", async () => {
    const view = renderInColumn({
      id: "a",
      component: "Image",
      url: "https://example.com/broken.png",
      description: "Chart",
      fallback: "No chart",
    });
    await fireEvent.error(await view.findByAltText("Chart"));
    // A style object adds no unit to a number, so the default is "64px".
    expect(view.getByText("No chart").style.minHeight).toBe("64px");
  });
});

describe("Image lightbox", () => {
  it("opens the image full-screen on click and closes on Escape", async () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Image",
        url: "https://example.com/a.png",
        description: "A",
      },
    ]);
    const img = await view.findByAltText("A");
    expect(lightbox()).toBeNull();
    await fireEvent.click(img);
    expect(shownSrc()).toBe("https://example.com/a.png");
    await pressEscape();
    expect(lightbox()).toBeNull();
  });

  it("closes the lightbox when the Image that opened it is destroyed", async () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Image",
        url: "https://example.com/c.png",
        description: "C",
      },
    ]);
    await fireEvent.click(await view.findByAltText("C"));
    expect(lightbox()).not.toBeNull();
    view.unmount();
    expect(lightbox()).toBeNull();
  });

  it("does not open a lightbox when lightbox is false", async () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Image",
        url: "https://example.com/b.png",
        description: "B",
        lightbox: false,
      },
    ]);
    const img = await view.findByAltText("B");
    expect(img.hasAttribute("data-a2ui-lightbox-trigger")).toBe(false);
    await fireEvent.click(img);
    expect(lightbox()).toBeNull();
  });
});

describe("Image variant sizes", () => {
  it("gives the icon, avatar and smallFeature variants their sizes in pixels", async () => {
    const view = renderSurface(ui, [
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
    expect((await view.findByAltText("icon")).style.width).toBe("24px");
    expect(view.getByAltText("avatar").style.height).toBe("40px");
    expect(view.getByAltText("small").style.maxWidth).toBe("160px");
  });
});

describe("AudioPlayer", () => {
  it("renders an AudioPlayer with its description above the player", async () => {
    const view = renderInColumn({
      id: "a",
      component: "AudioPlayer",
      url: "https://example.com/a.mp3",
      description: "Intro",
    });
    await view.findByText("end");
    const figure = view.container.querySelector("figure")!;
    expect(figure.querySelector("figcaption")?.textContent).toBe("Intro");
    const audio = figure.querySelector("audio")!;
    expect(audio.getAttribute("src")).toBe("https://example.com/a.mp3");
    expect(audio.getAttribute("aria-label")).toBe("Intro");
  });
});
