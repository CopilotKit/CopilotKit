import { describe, expect, it } from "vitest";
import { videoSourceOf, youTubeIdOf } from "..";
import { renderSurface, updateDataModel } from "../../../__tests__/render";
import { renderInColumn, ui } from "./helpers";

describe("Video", () => {
  it("embeds a YouTube link in privacy-enhanced mode once the user presses play", () => {
    const view = renderInColumn(
      {
        id: "y",
        component: "Video",
        url: "https://youtu.be/dQw4w9WgXcQ",
        posterUrl: "https://example.com/poster.png",
        accessibility: { description: "The launch keynote" },
      },
      {
        id: "w",
        component: "Video",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s",
        title: "Clip",
      },
    );
    const play = view.container.querySelector<HTMLButtonElement>("button")!;
    expect(play.getAttribute("aria-label")).toBe("Play video");
    expect(play.getAttribute("aria-description")).toBe("The launch keynote");
    expect(play.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/poster.png",
    );
    // A watch URL is a YouTube video too, and the title names its button.
    expect(
      view.container.querySelector('button[aria-label="Play Clip"]'),
    ).not.toBeNull();
    expect(view.container.querySelector("iframe")).toBeNull();
    view.act(() => play.click());
    const frame = view.container.querySelector("iframe")!;
    expect(frame.getAttribute("title")).toBe("YouTube video");
    expect(frame.getAttribute("aria-description")).toBe("The launch keynote");
    expect(frame.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1",
    );
    expect(frame.getAttribute("sandbox")).toBe(
      "allow-scripts allow-same-origin allow-presentation",
    );
  });

  it("shows the poster again, without autoplay, when the url of a playing video changes", () => {
    const view = renderSurface(
      ui,
      [{ id: "root", component: "Video", url: { "@path": "/url" } }],
      { url: "https://youtu.be/dQw4w9WgXcQ" },
    );
    view.act(() => view.container.querySelector("button")!.click());
    expect(view.container.querySelector("iframe")).not.toBeNull();
    view.update(updateDataModel("/url", "https://youtu.be/abcDEF12345"));
    expect(view.container.querySelector("iframe")).toBeNull();
    view.act(() => view.container.querySelector("button")!.click());
    expect(view.container.querySelector("iframe")!.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/abcDEF12345?autoplay=1",
    );
  });

  it("shows the poster, without autoplay, when the url returns to a video played before", () => {
    const view = renderSurface(
      ui,
      [{ id: "root", component: "Video", url: { "@path": "/url" } }],
      { url: "https://youtu.be/dQw4w9WgXcQ" },
    );
    view.act(() => view.container.querySelector("button")!.click());
    view.update(updateDataModel("/url", "https://youtu.be/abcDEF12345"));
    view.update(updateDataModel("/url", "https://youtu.be/dQw4w9WgXcQ"));
    expect(view.container.querySelector("iframe")).toBeNull();
    expect(view.container.querySelector("button")).not.toBeNull();
  });

  it("never embeds a YouTube URL whose id is not a plain id: a page the player cannot play shows as a link", () => {
    const view = renderInColumn({
      id: "y",
      component: "Video",
      url: "https://www.youtube.com/watch?v=../../evil",
    });
    expect(view.container.querySelector("iframe")).toBeNull();
    expect(view.container.querySelector("video")).toBeNull();
    const link = view.container.querySelector("[data-a2ui-video-link]");
    expect(link?.tagName).toBe("A");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("shows a link card for a page on another video site, and the native player with captions for a file", () => {
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
    const link = view.container.querySelector(
      'a[aria-label="Open Launch keynote on vimeo.com"]',
    )!;
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

  it("replaces a native player with the link when the file does not load", () => {
    const view = renderInColumn({
      id: "f",
      component: "Video",
      url: "https://cdn.example.com/missing.mp4",
      title: "Clip",
    });
    const video = view.container.querySelector("video")!;
    expect(video.getAttribute("aria-label")).toBe("Clip");
    view.act(() => video.dispatchEvent(new Event("error")));
    const link = view.container.querySelector(
      'a[aria-label="Open Clip on cdn.example.com"]',
    )!;
    expect(link.getAttribute("href")).toBe(
      "https://cdn.example.com/missing.mp4",
    );
    expect(view.container.querySelector("video")).toBeNull();
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

describe("AudioPlayer", () => {
  it("renders an AudioPlayer with its description above the player", () => {
    const view = renderInColumn({
      id: "a",
      component: "AudioPlayer",
      url: "https://example.com/a.mp3",
      description: "Intro",
    });
    const figure = view.container.querySelector("figure")!;
    expect(figure.querySelector("figcaption")?.textContent).toBe("Intro");
    const audio = figure.querySelector("audio")!;
    expect(audio.getAttribute("src")).toBe("https://example.com/a.mp3");
    expect(audio.getAttribute("aria-label")).toBe("Intro");
  });
});
