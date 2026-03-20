// Derived from hashbrown/packages/core/src/magic-text/citations.ts
// Original: https://github.com/liveloveapp/hashbrown
// License: MIT (see LICENSE-THIRD-PARTY)

import { describe, it, expect } from "vitest";
import { extractCitations, Citation } from "../citations";

describe("extractCitations", () => {
  describe("no citations", () => {
    it("should return an empty array for text with no citations", () => {
      expect(extractCitations("Hello world")).toEqual([]);
    });

    it("should not match regular bracket expressions", () => {
      expect(extractCitations("array[0] and map[key]")).toEqual([]);
    });
  });

  describe("single citation", () => {
    it("should extract a single numeric footnote citation", () => {
      const result = extractCitations("Some text [^1] more text");
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual<Citation>({
        label: "1",
        raw: "[^1]",
        start: 10,
        end: 14,
      });
    });

    it("should extract a citation with a text label", () => {
      const result = extractCitations("Reference [^note] here");
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual<Citation>({
        label: "note",
        raw: "[^note]",
        start: 10,
        end: 17,
      });
    });
  });

  describe("multiple citations", () => {
    it("should extract multiple citations from text", () => {
      const result = extractCitations("First [^1] and second [^2] end");
      expect(result).toHaveLength(2);
      expect(result[0].label).toBe("1");
      expect(result[0].start).toBe(6);
      expect(result[0].end).toBe(10);
      expect(result[1].label).toBe("2");
      expect(result[1].start).toBe(22);
      expect(result[1].end).toBe(26);
    });

    it("should handle citations at the start and end of text", () => {
      const result = extractCitations("[^a] middle [^b]");
      expect(result).toHaveLength(2);
      expect(result[0].label).toBe("a");
      expect(result[1].label).toBe("b");
    });
  });

  describe("footnote-style citations", () => {
    it("should extract footnote references like [^1]", () => {
      const result = extractCitations("See [^1] for details.");
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual<Citation>({
        label: "1",
        raw: "[^1]",
        start: 4,
        end: 8,
      });
    });

    it("should handle multi-digit footnote references", () => {
      const result = extractCitations("See [^42].");
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe("42");
    });

    it("should handle mixed alphanumeric labels", () => {
      const result = extractCitations("[^ref1] and [^ref2]");
      expect(result).toHaveLength(2);
      expect(result[0].label).toBe("ref1");
      expect(result[1].label).toBe("ref2");
    });
  });

  describe("empty input", () => {
    it("should return an empty array for an empty string", () => {
      expect(extractCitations("")).toEqual([]);
    });
  });

  describe("global regex lastIndex reset", () => {
    it("should produce consistent results across sequential calls", () => {
      const text = "Citation [^1] here";
      const first = extractCitations(text);
      const second = extractCitations(text);

      expect(first).toEqual(second);
      expect(first).toHaveLength(1);
      expect(first[0].label).toBe("1");
    });

    it("should work correctly after a call with no matches", () => {
      extractCitations("no citations here");
      const result = extractCitations("has [^1] citation");
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe("1");
    });
  });
});
