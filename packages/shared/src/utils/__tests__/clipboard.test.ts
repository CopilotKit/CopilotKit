import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { copyToClipboard } from "../clipboard";

// Mock navigator for Node 20 environments where it doesn't exist
if (typeof globalThis.navigator === "undefined") {
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText: vi.fn() } },
    writable: true,
    configurable: true,
  });
}

describe("copyToClipboard", () => {
  let originalClipboard: Clipboard;

  beforeEach(() => {
    originalClipboard = navigator.clipboard;
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      writable: true,
      configurable: true,
    });
  });

  it("returns true on successful clipboard write", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });

    const result = await copyToClipboard("hello");
    expect(result).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith("hello");
  });

  it("returns false when clipboard API is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await copyToClipboard("hello");
    expect(result).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith("Clipboard API is not available");
    consoleSpy.mockRestore();
  });

  it("returns false when writeText is not available", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: {},
      writable: true,
      configurable: true,
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await copyToClipboard("hello");
    expect(result).toBe(false);
    consoleSpy.mockRestore();
  });

  it("returns false when writeText rejects", async () => {
    const writeTextMock = vi
      .fn()
      .mockRejectedValue(new Error("Permission denied"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await copyToClipboard("hello");
    expect(result).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to copy to clipboard:",
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });
});
