import React from "react";
import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { A2UIComponentNode } from "@copilotkit/shared";
import { createGenerativeUI } from "../../catalog";
import { layoutComponents } from "../layout";
import { mediaComponents } from "../media";
import { renderSurface } from "./render";

/** A test-only text leaf, so the media tests need no other group. */
function Label({ text }: { text: string }) {
  return <span>{text}</span>;
}

const ui = createGenerativeUI({
  id: "test/media@1",
  components: {
    ...layoutComponents,
    ...mediaComponents,
    Label: { component: Label, props: z.object({ text: z.string() }) },
  },
});

/** Renders the media nodes in a Column, then a Label "end" after them. */
function renderInColumn(...nodes: A2UIComponentNode[]) {
  return renderSurface(ui, [
    {
      id: "root",
      component: "Column",
      children: [...nodes.map((node) => node.id), "end"],
    },
    ...nodes,
    { id: "end", component: "Label", text: "end" },
  ]);
}

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
      expect(ui.manifestComponents[name].description).toMatch(/\S/);
    }
  });
});

describe("standard media", () => {
  it("renders an Image with its alt text, ratio and radius", async () => {
    const view = renderInColumn({
      id: "i",
      component: "Image",
      url: "https://example.com/a.png",
      description: "pic",
      aspectRatio: "16/9",
      radius: "lg",
    });
    const image = await view.findByAltText("pic");
    expect(image.getAttribute("src")).toBe("https://example.com/a.png");
    expect(image.style.aspectRatio).toBe("16/9");
    expect(image.style.width).toBe("100%");
    expect(image.style.borderRadius).toBe("var(--a2ui-radius-lg, 12px)");
  });

  it("reads the Image src from the data model", async () => {
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
    expect((await view.findByAltText("bound")).getAttribute("src")).toBe(
      "https://example.com/b.png",
    );
  });

  it("removes an Image that fails to load when hideOnFailure is set", async () => {
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
    const hidden = await view.findByAltText("hidden");
    fireEvent.error(hidden);
    fireEvent.error(view.getByAltText("kept"));
    expect(view.queryByAltText("hidden")).toBeNull();
    expect(view.getByAltText("kept")).toBeInstanceOf(HTMLImageElement);
  });

  it("loads a lucide Icon on first use and hides it from screen readers", async () => {
    const view = renderInColumn({
      id: "c",
      component: "Icon",
      name: "arrow-right",
      size: "lg",
    });
    await waitFor(() =>
      expect(
        view.container.querySelector("svg.lucide-arrow-right"),
      ).not.toBeNull(),
    );
    const icon = view.container.querySelector("svg.lucide-arrow-right")!;
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.getAttribute("width")).toBe("24");
  });

  it("names an Icon with a label for screen readers", async () => {
    const view = renderInColumn({
      id: "c",
      component: "Icon",
      name: "check",
      label: "Done",
    });
    const icon = await view.findByRole("img", { name: "Done" });
    expect(icon.getAttribute("aria-hidden")).toBeNull();
  });

  it("renders nothing for an Icon with an unknown name", async () => {
    const view = renderInColumn(
      { id: "c", component: "Icon", name: "definitely-not-an-icon" },
      { id: "k", component: "Icon", name: "check" },
    );
    // The known icon shows that the icon set has loaded.
    await waitFor(() =>
      expect(view.container.querySelector("svg.lucide-check")).not.toBeNull(),
    );
    expect(view.container.querySelectorAll("svg")).toHaveLength(1);
  });

  it("renders a Favicon from the host of the URL", async () => {
    const view = renderInColumn(
      {
        id: "f",
        component: "Favicon",
        url: "https://copilotkit.ai/docs",
        alt: "ck",
      },
      { id: "g", component: "Favicon", url: "example.com" },
    );
    expect((await view.findByAltText("ck")).getAttribute("src")).toBe(
      "https://www.google.com/s2/favicons?domain=copilotkit.ai&sz=64",
    );
    expect(view.getByAltText("example.com").getAttribute("src")).toBe(
      "https://www.google.com/s2/favicons?domain=example.com&sz=64",
    );
  });

  it("draws an Svg from shapes with token colors and pixel sizes", async () => {
    const view = renderInColumn({
      id: "s",
      component: "Svg",
      viewBox: "0 0 10 10",
      width: 240,
      height: 80,
      paths: [{ d: "M0 0L10 10", stroke: "danger" }],
      circles: [{ cx: 5, cy: 5, r: 4 }],
      texts: [{ x: 1, y: 9, text: "hi" }],
    });
    await view.findByText("end");
    const svg = view.container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("240");
    expect(svg.getAttribute("height")).toBe("80");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    const path = svg.querySelector("path[d='M0 0L10 10']")!;
    expect(path.getAttribute("stroke")).toBe(
      "var(--a2ui-color-text-danger, #c1322c)",
    );
    expect(svg.querySelectorAll("circle")).toHaveLength(1);
    expect(svg.querySelector("text")!.textContent).toBe("hi");
  });

  it("names an Svg with a label for screen readers", async () => {
    const view = renderInColumn({
      id: "s",
      component: "Svg",
      label: "Floor plan",
      rects: [{ x: 0, y: 0, width: 4, height: 4 }],
    });
    expect(await view.findByRole("img", { name: "Floor plan" })).toBeInstanceOf(
      SVGSVGElement,
    );
  });

  it("embeds a YouTube link in privacy-enhanced mode once the user presses play", async () => {
    const view = renderInColumn({
      id: "y",
      component: "Video",
      url: "https://youtu.be/dQw4w9WgXcQ",
      posterUrl: "https://example.com/poster.png",
    });
    const play = await view.findByRole("button", { name: "Play video" });
    // The poster given by the model, not the YouTube thumbnail.
    expect(play.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/poster.png",
    );
    expect(view.container.querySelector("iframe")).toBeNull();
    fireEvent.click(play);
    const frame = await view.findByTitle("YouTube video");
    expect(frame.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1",
    );
    expect(frame.getAttribute("sandbox")).toBe(
      "allow-scripts allow-same-origin allow-presentation",
    );
  });

  it("never embeds a YouTube URL whose id is not a plain id", async () => {
    const view = renderInColumn({
      id: "y",
      component: "Video",
      url: "https://www.youtube.com/watch?v=../../evil",
    });
    await view.findByText("end");
    expect(view.container.querySelector("iframe")).toBeNull();
    expect(view.container.querySelector("video")).not.toBeNull();
  });

  it("renders HtmlView in a fully sandboxed iframe that runs no script", async () => {
    const view = renderInColumn({
      id: "h",
      component: "HtmlView",
      html: "<b>hi</b><script>window.__htmlViewRan=1</script>",
      height: 100,
    });
    const frame = await view.findByTitle("HTML content");
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("srcdoc")).toBe(
      "<b>hi</b><script>window.__htmlViewRan=1</script>",
    );
    expect(frame.style.height).toBe("100px");
    expect("__htmlViewRan" in window).toBe(false);
  });
});
