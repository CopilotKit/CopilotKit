// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DocsVideoPreview } from "../docs-video-preview";

vi.mock("@/lib/use-homepage-telemetry", () => ({
  useHomepageTelemetry: () => vi.fn(),
}));
let onVisibility: IntersectionObserverCallback;
let reducedMotion = false;
const play = vi.fn().mockResolvedValue(undefined);
const pause = vi.fn();
beforeEach(() => {
  reducedMotion = false;
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reducedMotion;
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        onVisibility = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function visible(inView: boolean) {
  act(() =>
    onVisibility(
      [
        {
          isIntersecting: inView,
          intersectionRatio: inView ? 1 : 0,
        } as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    ),
  );
}
function setup() {
  return render(
    <DocsVideoPreview
      title="Tour"
      loomId="recording"
      poster="/poster.jpg"
      previewSrc="/preview.mp4"
    />,
  );
}
it("plays a silent local loop only in view, then replaces it with full Loom playback on click", () => {
  const { container } = setup();
  expect(container.querySelector("iframe")).toBeNull();
  visible(true);
  const video = container.querySelector("video")!;
  expect(video.muted).toBe(true);
  expect(video.loop).toBe(true);
  expect(play).toHaveBeenCalled();
  visible(false);
  expect(pause).toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Watch full walkthrough: Tour" }),
  );
  expect(container.querySelector("video")).toBeNull();
  expect(container.querySelector("iframe")?.src).toContain(
    "https://www.loom.com/embed/recording?autoplay=1",
  );
});
it("keeps the poster under reduced motion while allowing explicit full playback", () => {
  reducedMotion = true;
  const { container } = setup();
  visible(true);
  expect(container.querySelector("video")).toBeNull();
  expect(play).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Watch full walkthrough: Tour" }),
  );
  expect(container.querySelector("iframe")).not.toBeNull();
});
