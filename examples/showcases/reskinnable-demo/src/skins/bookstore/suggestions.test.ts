// src/skins/bookstore/suggestions.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { bookstoreSuggestions } from "./suggestions";

// Resolved from the project root, not `import.meta.url`: under Vitest's Vite
// transform `import.meta.url` is not a file: URL, so `new URL(…)` throws (see
// src/app/globals.chat-scope.test.ts for the same workaround).
const SOURCE = readFileSync(
  path.resolve(process.cwd(), "src/skins/bookstore/suggestions.ts"),
  "utf8",
);

describe("bookstoreSuggestions", () => {
  it("ships seven pills, one per demo step", () => {
    expect(bookstoreSuggestions).toHaveLength(7);
  });

  it("keeps them in demo order", () => {
    // Order is the demo script. A reorder breaks the walk, and free-typed
    // phrasing routes to the wrong tool — which is the whole reason pills exist.
    expect(bookstoreSuggestions.map((s) => s.title)).toEqual([
      "What's new",
      "Something for me",
      "Cheapest sci-fi",
      "What's on screen?",
      "Add the top pick",
      "Check out",
      "Book club order",
    ]);
  });

  it("gives every pill a non-empty title and message", () => {
    for (const pill of bookstoreSuggestions) {
      expect(pill.title.trim().length).toBeGreaterThan(0);
      expect(pill.message.trim().length).toBeGreaterThan(0);
    }
  });

  it("carries the mandatory beat map, with every beat row present", () => {
    // demo-beats.md requires the beat map to be reproduced at the top of this
    // file. Asserting it here is what stops it being deleted in a tidy-up.
    const source = SOURCE;
    for (const beat of [
      "1 face",
      "2 rich thread",
      "3a drive the app",
      "3b sees my screen",
      "3c levers",
      "3d multimodal",
      "4 memory",
      "5 stored skill",
      "6 teach a skill",
    ]) {
      expect(source, `beat map is missing "${beat}"`).toContain(beat);
    }
  });

  it("records the deferred beats as SKIPPED rather than dropping the rows", () => {
    const source = SOURCE;
    expect(source.match(/SKIPPED/g) ?? []).toHaveLength(2);
  });
});
