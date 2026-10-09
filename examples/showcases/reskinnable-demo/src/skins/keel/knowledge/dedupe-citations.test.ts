import { describe, expect, it } from "vitest";
import { dedupeCitations } from "./dedupe-citations";
import type { Citation } from "./types";

const cite = (docId: string, sectionId: string, snippet = ""): Citation => ({
  docId,
  ref: `${docId.toUpperCase()}-1`,
  sectionId,
  heading: `${docId} / ${sectionId}`,
  snippet,
});

describe("dedupeCitations", () => {
  it("collapses repeated (docId, sectionId) pairs to a single entry", () => {
    const input = [
      cite("phi-access-policy", "minimum-necessary"),
      cite("phi-access-policy", "minimum-necessary"),
    ];
    const out = dedupeCitations(input);
    expect(out).toHaveLength(1);
  });

  it("produces a collision-free docId#sectionId key set", () => {
    const input = [
      cite("phi-access-policy", "minimum-necessary"),
      cite("phi-access-policy", "minimum-necessary"),
      cite("vendor-standard", "onboarding"),
    ];
    const keys = dedupeCitations(input).map((c) => `${c.docId}#${c.sectionId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps distinct passages and preserves first-seen order", () => {
    const input = [
      cite("b-doc", "s2"),
      cite("a-doc", "s1"),
      cite("b-doc", "s2"),
      cite("a-doc", "s3"),
    ];
    const out = dedupeCitations(input);
    expect(out.map((c) => `${c.docId}#${c.sectionId}`)).toEqual([
      "b-doc#s2",
      "a-doc#s1",
      "a-doc#s3",
    ]);
  });

  it("returns an empty list unchanged", () => {
    expect(dedupeCitations([])).toEqual([]);
  });
});
