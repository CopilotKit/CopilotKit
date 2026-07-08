import { afterEach, describe, expect, it, vi } from "vitest";
import { isMobileViewport } from "../is-mobile-viewport";

describe("isMobileViewport", () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  it("returns false when window.matchMedia is undefined", () => {
    // @ts-expect-error - simulating an environment without matchMedia support.
    delete window.matchMedia;

    expect(isMobileViewport()).toBe(false);
  });

  it("returns true when the mobile media query matches", () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      media: "(max-width: 767px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList);

    expect(isMobileViewport()).toBe(true);
  });

  it("returns false when the mobile media query does not match", () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      media: "(max-width: 767px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList);

    expect(isMobileViewport()).toBe(false);
  });
});
