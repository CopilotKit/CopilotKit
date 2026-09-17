// @vitest-environment jsdom
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntelligencePreview } from "../intelligence-preview";

vi.mock("../content/landing-pages/intelligence-overview", () => ({
  INTELLIGENCE_SIZZLE_VIDEO_URL: "https://example.com/preview.mp4",
}));
let intersect: (entries: Partial<IntersectionObserverEntry>[]) => void;
let motion: EventTarget & { matches: boolean };
let play: ReturnType<typeof vi.fn>;
let pause: ReturnType<typeof vi.fn>;

beforeEach(() => {
  motion = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("matchMedia", () => motion);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: typeof intersect) {
        intersect = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  play = vi.fn(function (this: HTMLVideoElement) {
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  pause = vi.fn(function (this: HTMLVideoElement) {
    this.dispatchEvent(new Event("pause"));
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const view = (visible: boolean) =>
  act(() =>
    intersect([
      { isIntersecting: visible, intersectionRatio: visible ? 1 : 0 },
    ]),
  );

describe("Intelligence preview", () => {
  it("plays silently only while visible and stops after eight seconds without looping", () => {
    render(<IntelligencePreview />);
    const video = screen.getByLabelText(
      "Eight-second silent Intelligence preview",
    ) as HTMLVideoElement;
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(false);
    expect(play).not.toHaveBeenCalled();
    view(true);
    expect(play).toHaveBeenCalledTimes(1);
    view(false);
    expect(pause).toHaveBeenCalled();
    view(true);
    video.currentTime = 8;
    fireEvent.timeUpdate(video);
    expect(
      screen.getByRole("button", { name: "Replay 8-second preview" }),
    ).toBeTruthy();
    const calls = play.mock.calls.length;
    view(false);
    view(true);
    expect(play).toHaveBeenCalledTimes(calls);
    fireEvent.click(
      screen.getByRole("button", { name: "Replay 8-second preview" }),
    );
    expect(video.currentTime).toBe(0);
    expect(play).toHaveBeenCalledTimes(calls + 1);
  });

  it("honors reduced motion until the visitor explicitly plays the preview", () => {
    motion.matches = true;
    render(<IntelligencePreview />);
    view(true);
    expect(play).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Play 8-second preview" }),
    );
    expect(play).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Pause preview" }));
    view(false);
    view(true);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("pauses in a hidden tab and retains a full walkthrough action outside the video", () => {
    render(
      <IntelligencePreview>
        <a href="https://example.com/full">Watch full walkthrough</a>
      </IntelligencePreview>,
    );
    view(true);
    act(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(pause).toHaveBeenCalled();
    const link = screen.getByRole("link", { name: "Watch full walkthrough" });
    expect(link.closest("video")).toBeNull();
  });
});
