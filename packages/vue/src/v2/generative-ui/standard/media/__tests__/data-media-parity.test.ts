import { fireEvent, waitFor } from "@testing-library/vue";
import { describe, expect, it, vi } from "vitest";
import type { A2UIComponentNode } from "@copilotkit/shared";
import { renderSurface } from "../../../__tests__/helpers/render-surface";
import { ui } from "./helpers";

// The media cases of React's `standard/__tests__/data-media-parity.test.tsx`.
// React renders with `standardUI`; this file uses the media components and a
// test-only Column. The data cases (Table, List, Chart, Map) belong to the
// data group.
vi.mock("lucide", () => import("./fake-lucide"));

const render = (components: A2UIComponentNode[]) =>
  renderSurface(ui, components);

describe("standard catalog: data and media (parity)", () => {
  it("Image, Icon, Favicon, Svg, Video, AudioPlayer, HtmlView render safely", async () => {
    const v = render([
      {
        id: "root",
        component: "Column",
        children: ["i", "c", "f", "s", "y", "au", "h"],
      },
      {
        id: "i",
        component: "Image",
        url: "https://example.com/a.png",
        description: "pic",
        aspectRatio: "16/9",
        radius: "lg",
      },
      { id: "c", component: "Icon", name: "arrow-right", size: "md" },
      {
        id: "f",
        component: "Favicon",
        url: "https://copilotkit.ai",
        alt: "ck",
      },
      {
        id: "s",
        component: "Svg",
        viewBox: "0 0 10 10",
        paths: [{ d: "M0 0L10 10", stroke: "danger" }],
      },
      { id: "y", component: "Video", url: "https://example.com/clip.mp4" },
      {
        id: "au",
        component: "AudioPlayer",
        url: "https://example.com/clip.mp3",
        description: "A clip",
      },
      {
        id: "h",
        component: "HtmlView",
        html: "<b>hi</b><script>window.__x=1</script>",
        height: 100,
      },
    ]);
    expect((await v.findByAltText("pic")).getAttribute("src")).toContain(
      "a.png",
    );
    expect(v.container.querySelector("svg")).not.toBeNull();
    const iframes = v.container.querySelectorAll("iframe");
    expect(iframes.length).toBe(1);
    expect(iframes[0]!.getAttribute("sandbox")).toBe("");
    expect("__x" in window).toBe(false);
    // A plain video URL plays in a native element, with no third party.
    expect(v.container.querySelector("video")?.getAttribute("src")).toBe(
      "https://example.com/clip.mp4",
    );
    expect(v.container.querySelector("audio")?.getAttribute("src")).toBe(
      "https://example.com/clip.mp3",
    );
    expect(v.getByText("A clip").tagName).toBe("FIGCAPTION");
    expect(v.getByAltText("ck").getAttribute("src")).toBe(
      "https://www.google.com/s2/favicons?domain=copilotkit.ai&sz=64",
    );
    expect(v.container.querySelector("path[d='M0 0L10 10']")).not.toBeNull();
    await waitFor(() =>
      expect(
        v.container.querySelector("svg.lucide-arrow-right"),
      ).not.toBeNull(),
    );
  });

  it("Image shows the fallback text when the image fails to load", async () => {
    const v = render([
      {
        id: "root",
        component: "Image",
        url: "https://example.com/missing.png",
        description: "Missing",
        fallback: "Image unavailable",
      },
    ]);
    await fireEvent.error(await v.findByAltText("Missing"));
    expect(await v.findByText("Image unavailable")).not.toBeNull();
  });

  it("Image actionOverlay dispatches its action", async () => {
    const v = render([
      {
        id: "root",
        component: "Image",
        url: "https://example.com/a.png",
        description: "A",
        actionOverlay: { label: "Save" },
        onOverlayClick: { event: { name: "save" } },
      },
    ]);
    await fireEvent.click(await v.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(v.forwardEvent).toHaveBeenCalledOnce());
    expect(v.forwardEvent.mock.calls[0]![0].name).toBe("save");
  });

  it("Image hoverZoom and position apply", async () => {
    const v = render([
      {
        id: "root",
        component: "Image",
        url: "https://example.com/a.png",
        description: "Z",
        hoverZoom: true,
        position: "top",
      },
    ]);
    const img = await v.findByAltText("Z");
    expect(img.style.objectPosition).toBe("top");
    expect(img.style.transition).toContain("transform");
    expect(img.parentElement!.style.overflow).toBe("hidden");
  });

  it("Video with a YouTube URL shows a poster first and loads the player on click", async () => {
    const v = render([
      {
        id: "root",
        component: "Video",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s",
        title: "Clip",
      },
    ]);
    const play = await v.findByRole("button", { name: "Play Clip" });
    expect(v.container.querySelector("iframe")).toBeNull();
    await fireEvent.click(play);
    const iframe = v.container.querySelector("iframe")!;
    expect(iframe.getAttribute("src")).toContain("dQw4w9WgXcQ");
    expect(iframe.getAttribute("src")).toContain("autoplay=1");
  });

  it("Svg treats numeric width and height as pixels and takes stroke props", async () => {
    const v = render([
      {
        id: "root",
        component: "Svg",
        viewBox: "0 0 10 10",
        width: 240,
        height: 80,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        preserveAspectRatio: "none",
        circles: [{ cx: 5, cy: 5, r: 4 }],
      },
    ]);
    await waitFor(() =>
      expect(v.container.querySelector("svg")).not.toBeNull(),
    );
    const svg = v.container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("240");
    expect(svg.getAttribute("height")).toBe("80");
    expect(svg.getAttribute("stroke-linecap")).toBe("round");
    expect(svg.getAttribute("preserveAspectRatio")).toBe("none");
  });
});
