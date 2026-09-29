import { afterEach, describe, expect, it, vi } from "vitest";
import { startProductInteractionCapture } from "./capture";

afterEach(() => vi.unstubAllGlobals());

describe("capture lifecycle", () => {
  it("does not capture synthetic clicks, changes, submits, or their requests", async () => {
    document.body.innerHTML =
      '<form><button>Save</button><input value="private"></form>';
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response()));
    const onEvent = vi.fn();
    const stop = startProductInteractionCapture({ onEvent });
    const button = document.querySelector("button")!;
    button.addEventListener("click", () => {
      void window.fetch("/api/save");
    });
    for (const type of ["click", "change", "submit"])
      button.dispatchEvent(new Event(type, { bubbles: true }));
    await Promise.resolve();
    expect(onEvent).not.toHaveBeenCalled();
    stop();
  });

  it("does not patch globals when disabled and is safe without a browser", () => {
    const originalFetch = window.fetch;
    const stop = startProductInteractionCapture({
      enabled: false,
      onEvent: vi.fn(),
    });
    expect(window.fetch).toBe(originalFetch);
    stop();
    vi.stubGlobal("window", undefined);
    expect(() =>
      startProductInteractionCapture({ onEvent: vi.fn() })(),
    ).not.toThrow();
  });

  it("supports idempotent cleanup and DOM-only capture", () => {
    const originalFetch = window.fetch;
    const stop = startProductInteractionCapture({
      captureRequests: false,
      onEvent: vi.fn(),
    });
    expect(window.fetch).toBe(originalFetch);
    stop();
    stop();
    const stopAgain = startProductInteractionCapture({ onEvent: vi.fn() });
    stopAgain();
    expect(window.fetch).toBe(originalFetch);
  });
});
