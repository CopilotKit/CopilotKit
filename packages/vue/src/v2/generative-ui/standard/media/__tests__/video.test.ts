import { fireEvent } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import { renderSurface } from "../../../__tests__/helpers/render-surface";
import { videoSourceOf, youTubeIdOf } from "../index";
import { ui, updateDataModel } from "./helpers";

// The Video cases of Angular's `standard/media/__tests__/video.spec.ts` that
// React's suites do not have. The cases both have are in `media.test.ts`
// and `data-media-parity.test.ts`.

/** A Video whose url is bound to `/url`, first at `url`. */
async function renderBoundVideo(url: string) {
  const view = renderSurface(
    ui,
    [{ id: "root", component: "Video", url: { "@path": "/url" } }],
    { url },
  );
  const play = () => fireEvent.click(view.getByRole("button"));
  const setUrl = (next: string) => view.update(updateDataModel("/url", next));
  await view.findByRole("button");
  return { view, play, setUrl };
}

describe("Video", () => {
  it("shows the poster again, without autoplay, when the url of a playing video changes", async () => {
    const { view, play, setUrl } = await renderBoundVideo(
      "https://youtu.be/dQw4w9WgXcQ",
    );
    await play();
    expect(view.container.querySelector("iframe")).not.toBeNull();
    await setUrl("https://youtu.be/abcDEF12345");
    expect(view.container.querySelector("iframe")).toBeNull();
    await play();
    expect(view.container.querySelector("iframe")!.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/abcDEF12345?autoplay=1",
    );
  });

  it("shows the poster, without autoplay, when the url returns to a video played before", async () => {
    const { view, play, setUrl } = await renderBoundVideo(
      "https://youtu.be/dQw4w9WgXcQ",
    );
    await play();
    await setUrl("https://youtu.be/abcDEF12345");
    await setUrl("https://youtu.be/dQw4w9WgXcQ");
    expect(view.container.querySelector("iframe")).toBeNull();
    expect(view.container.querySelector("button")).not.toBeNull();
  });

  it("classifies video URLs", () => {
    expect(youTubeIdOf("https://www.youtube.com/shorts/abcDEF12345")).toBe(
      "abcDEF12345",
    );
    expect(youTubeIdOf("https://example.com/a")).toBeUndefined();
    expect(videoSourceOf("https://youtu.be/dQw4w9WgXcQ")).toBe("youtube");
    expect(videoSourceOf("https://cdn.example.com/a.webm")).toBe("file");
    expect(videoSourceOf("https://www.tiktok.com/@a/video/1")).toBe("page");
    expect(videoSourceOf("not a url")).toBe("file");
  });
});
