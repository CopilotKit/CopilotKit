// Derived from hashbrown/packages/core/src/magic-text/segments.ts
// Original: https://github.com/liveloveapp/hashbrown
// License: MIT (see LICENSE-THIRD-PARTY)

import { describe, it, expect, vi, afterEach } from "vitest";
import { segmentText } from "../segments";

describe("segmentText", () => {
  describe("basic strings", () => {
    it("should segment a simple ASCII string into individual characters", () => {
      expect(segmentText("abc")).toEqual(["a", "b", "c"]);
    });

    it("should handle a single character", () => {
      expect(segmentText("x")).toEqual(["x"]);
    });

    it("should handle multi-word text", () => {
      expect(segmentText("hello world")).toEqual([
        "h", "e", "l", "l", "o", " ", "w", "o", "r", "l", "d",
      ]);
    });
  });

  describe("empty input", () => {
    it("should return an empty array for an empty string", () => {
      expect(segmentText("")).toEqual([]);
    });
  });

  describe("unicode and emoji handling", () => {
    it("should keep a simple emoji as a single segment", () => {
      const result = segmentText("\u{1F600}");
      expect(result).toEqual(["\u{1F600}"]);
    });

    it("should handle a string with mixed ASCII and emoji", () => {
      const result = segmentText("hi\u{1F44B}");
      expect(result).toEqual(["h", "i", "\u{1F44B}"]);
    });

    it("should handle multi-codepoint emoji (family ZWJ sequence)", () => {
      // The family emoji is a ZWJ sequence: man + ZWJ + woman + ZWJ + girl
      const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
      const result = segmentText(family);
      // Intl.Segmenter should treat the ZWJ sequence as one grapheme cluster
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(family);
    });

    it("should handle flag emoji (regional indicators)", () => {
      // US flag: regional indicator U + regional indicator S
      const flag = "\u{1F1FA}\u{1F1F8}";
      const result = segmentText(flag);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(flag);
    });
  });

  describe("Intl.Segmenter fallback", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should fall back to Array.from when Intl.Segmenter is unavailable", () => {
      // Mock Intl.Segmenter as undefined to trigger fallback
      const originalSegmenter = Intl.Segmenter;
      vi.stubGlobal("Intl", { ...Intl, Segmenter: undefined });

      expect(segmentText("abc")).toEqual(["a", "b", "c"]);

      // Restore
      vi.stubGlobal("Intl", { ...Intl, Segmenter: originalSegmenter });
    });

    it("should handle basic emoji with Array.from fallback", () => {
      const originalSegmenter = Intl.Segmenter;
      vi.stubGlobal("Intl", { ...Intl, Segmenter: undefined });

      // Array.from splits by code points, so a simple emoji is still one entry
      const result = segmentText("\u{1F600}");
      expect(result).toEqual(["\u{1F600}"]);

      vi.stubGlobal("Intl", { ...Intl, Segmenter: originalSegmenter });
    });
  });
});
