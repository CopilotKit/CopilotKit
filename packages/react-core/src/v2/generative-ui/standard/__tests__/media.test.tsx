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

  it("hides an Image together with its action overlay", async () => {
    const view = renderInColumn({
      id: "a",
      component: "Image",
      url: "https://example.com/a.png",
      description: "Chart",
      actionOverlay: { label: "Open" },
      accessibility: { hidden: true, label: "Sales chart" },
    });
    const img = await view.findByAltText("Chart");
    const wrapper = img.parentElement!;
    expect(wrapper.getAttribute("aria-hidden")).toBe("true");
    expect(img.hasAttribute("aria-hidden")).toBe(false);
    // The name stays on the image: names do not inherit from a wrapper.
    expect(img.getAttribute("aria-label")).toBe("Sales chart");
    expect(wrapper.hasAttribute("aria-label")).toBe(false);
    expect(wrapper.querySelector("button")).not.toBeNull();
  });

  it("keeps the accessibility of the envelope on the fallback of a failed Image", async () => {
    const view = renderInColumn({
      id: "a",
      component: "Image",
      url: "https://example.com/broken.png",
      description: "Chart",
      fallback: "No chart",
      accessibility: { label: "Sales chart", hidden: true },
    });
    fireEvent.error(await view.findByAltText("Chart"));
    const fallback = view.getByText("No chart");
    expect(fallback.getAttribute("role")).toBe("img");
    expect(fallback.getAttribute("aria-label")).toBe("Sales chart");
    expect(fallback.getAttribute("aria-hidden")).toBe("true");
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

  it("names an Icon and an Svg by the envelope label, like the label prop", async () => {
    const view = renderInColumn(
      {
        id: "i",
        component: "Icon",
        name: "check",
        accessibility: { label: "Done", description: "The step is complete" },
      },
      {
        id: "s",
        component: "Svg",
        viewBox: "0 0 10 10",
        circles: [{ cx: 5, cy: 5, r: 4 }],
        accessibility: { label: "Dot" },
      },
    );
    const icon = await view.findByRole("img", { name: "Done" });
    expect(icon.getAttribute("aria-description")).toBe("The step is complete");
    expect(view.getByRole("img", { name: "Dot" }).tagName).toBe("svg");
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
      accessibility: { description: "The launch keynote" },
    });
    const play = await view.findByRole("button", { name: "Play video" });
    expect(play.getAttribute("aria-description")).toBe("The launch keynote");
    // The poster given by the model, not the YouTube thumbnail.
    expect(play.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/poster.png",
    );
    expect(view.container.querySelector("iframe")).toBeNull();
    fireEvent.click(play);
    const frame = await view.findByTitle("YouTube video");
    expect(frame.getAttribute("aria-description")).toBe("The launch keynote");
    expect(frame.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1",
    );
    expect(frame.getAttribute("sandbox")).toBe(
      "allow-scripts allow-same-origin allow-presentation",
    );
  });

  it("never embeds a YouTube URL whose id is not a plain id: a page the player cannot play shows as a link", async () => {
    const view = renderInColumn({
      id: "y",
      component: "Video",
      url: "https://www.youtube.com/watch?v=../../evil",
    });
    await view.findByText("end");
    expect(view.container.querySelector("iframe")).toBeNull();
    expect(view.container.querySelector("video")).toBeNull();
    const link = view.container.querySelector("[data-a2ui-video-link]");
    expect(link?.tagName).toBe("A");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("shows a link card for a page on another video site, and the native player with captions for a file", async () => {
    const view = renderInColumn(
      {
        id: "v",
        component: "Video",
        url: "https://vimeo.com/123456",
        title: "Launch keynote",
      },
      {
        id: "f",
        component: "Video",
        url: "https://cdn.example.com/clip.webm",
        captions: [
          {
            url: "https://cdn.example.com/en.vtt",
            language: "en",
            label: "English",
          },
          {
            url: "https://cdn.example.com/de.vtt",
            language: "de",
            kind: "captions",
          },
        ],
      },
      { id: "s", component: "Video", url: "https://streams.example.com/live" },
    );
    await view.findByText("end");
    const link = await view.findByRole("link", {
      name: "Open Launch keynote on vimeo.com",
    });
    expect(link.getAttribute("href")).toBe("https://vimeo.com/123456");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.textContent).toContain("Launch keynote");
    expect(link.textContent).toContain("vimeo.com");
    const videos = view.container.querySelectorAll("video");
    // A file by extension, and a URL that is not a video page, both play.
    expect(videos).toHaveLength(2);
    // Tracks load in the CORS mode of the player, so a player with captions has one.
    expect(videos[0]!.getAttribute("crossorigin")).toBe("anonymous");
    expect(videos[1]!.hasAttribute("crossorigin")).toBe(false);
    const tracks = videos[0]!.querySelectorAll("track");
    expect(tracks).toHaveLength(2);
    expect(tracks[0]!.getAttribute("srclang")).toBe("en");
    expect(tracks[0]!.getAttribute("kind")).toBe("subtitles");
    expect(tracks[0]!.hasAttribute("default")).toBe(true);
    expect(tracks[1]!.getAttribute("kind")).toBe("captions");
    expect(tracks[1]!.hasAttribute("default")).toBe(false);
  });

  it("replaces a native player with the link when the file does not load", async () => {
    const view = renderInColumn({
      id: "f",
      component: "Video",
      url: "https://cdn.example.com/missing.mp4",
    });
    const video = await waitFor(() => {
      const element = view.container.querySelector("video");
      if (!element) throw new Error("no player");
      return element;
    });
    fireEvent.error(video);
    const link = await view.findByRole("link", {
      name: "Open video on cdn.example.com",
    });
    expect(link.getAttribute("href")).toBe(
      "https://cdn.example.com/missing.mp4",
    );
    expect(view.container.querySelector("video")).toBeNull();
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
