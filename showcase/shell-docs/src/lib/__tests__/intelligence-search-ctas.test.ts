import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  INTELLIGENCE_SEARCH_CTAS,
  matchIntelligenceSearchCta,
} from "@/lib/intelligence-search-ctas";
import type { IntelligenceSearchCta } from "@/lib/intelligence-search-ctas";

const here = dirname(fileURLToPath(import.meta.url));
const contentRoot = resolve(here, "../../content/docs");

function everyDestination(cta: IntelligenceSearchCta): string[] {
  return [cta.primary.href, ...cta.secondary.map((link) => link.href)];
}

const ALL_ENTRIES = [...INTELLIGENCE_SEARCH_CTAS];
const ALL_LINKS = ALL_ENTRIES.flatMap((cta) =>
  [cta.primary, ...cta.secondary].map((link) => ({ cta, link })),
);

describe("Intelligence search CTA destinations", () => {
  it.each(ALL_LINKS)(
    "$cta.id → $link.href is an internal docs route",
    ({ link }) => {
      // An absolute URL would break the modal's client-side navigation and
      // drop the reader out of the docs entirely.
      expect(link.href.startsWith("/")).toBe(true);
      expect(link.href).not.toMatch(/^(https?:)?\/\//);
      expect(link.href.toLowerCase()).not.toContain("http");
    },
  );

  it.each(ALL_LINKS)(
    "$cta.id → $link.href resolves to a page in the content tree",
    ({ link }) => {
      expect(existsSync(resolve(contentRoot, `.${link.href}.mdx`))).toBe(true);
    },
  );

  it("gives every link a label and never repeats a destination inside one entry", () => {
    for (const cta of ALL_ENTRIES) {
      const destinations = everyDestination(cta);
      expect(new Set(destinations).size).toBe(destinations.length);
      for (const link of [cta.primary, ...cta.secondary]) {
        expect(link.label.trim().length).toBeGreaterThan(0);
      }
      expect(cta.title.trim().length).toBeGreaterThan(0);
      expect(cta.body.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("Intelligence search CTA matching", () => {
  it("fires the expected entry for a whole-word query", () => {
    expect(matchIntelligenceSearchCta("threads")?.id).toBe("threads");
    expect(matchIntelligenceSearchCta("thread")?.id).toBe("threads");
    expect(matchIntelligenceSearchCta("persistence")?.id).toBe("threads");
    expect(matchIntelligenceSearchCta("persistent")?.id).toBe("threads");
    expect(matchIntelligenceSearchCta("self-hosting")?.id).toBe("self-hosting");
    expect(matchIntelligenceSearchCta("self-host")?.id).toBe("self-hosting");
    expect(matchIntelligenceSearchCta("selfhosted")?.id).toBe("self-hosting");
    expect(matchIntelligenceSearchCta("self-hosted")?.id).toBe("self-hosting");
    expect(matchIntelligenceSearchCta("learning")?.id).toBe("learning");
    expect(matchIntelligenceSearchCta("analytics")?.id).toBe("analytics");
    expect(matchIntelligenceSearchCta("intelligence")?.id).toBe("intelligence");
  });

  it("does not fire on a word that merely contains a keyword", () => {
    // The reason plain substring matching is forbidden: "spreadsheets"
    // contains "threads".
    expect(matchIntelligenceSearchCta("spreadsheets")).toBeNull();
    expect(matchIntelligenceSearchCta("export spreadsheets")).toBeNull();
  });

  it("fires on a four-character prefix but not on a two-character one", () => {
    expect(matchIntelligenceSearchCta("intell")?.id).toBe("intelligence");
    expect(matchIntelligenceSearchCta("inte")?.id).toBe("intelligence");
    expect(matchIntelligenceSearchCta("int")).toBeNull();
    expect(matchIntelligenceSearchCta("in")).toBeNull();
    expect(matchIntelligenceSearchCta("thre")?.id).toBe("threads");
    expect(matchIntelligenceSearchCta("th")).toBeNull();
  });

  it("ignores case and extra whitespace", () => {
    expect(matchIntelligenceSearchCta("  THREADS  ")?.id).toBe("threads");
    expect(matchIntelligenceSearchCta("Self-Hosting")?.id).toBe("self-hosting");
    expect(matchIntelligenceSearchCta("  intelligence   threads ")?.id).toBe(
      "threads",
    );
  });

  it("stays out of the way of unrelated docs queries", () => {
    for (const query of [
      "useCopilotAction",
      "angular quickstart",
      "css",
      "",
      "   ",
      "generative ui",
      "mastra",
      "tool calls",
    ]) {
      expect(matchIntelligenceSearchCta(query)).toBeNull();
    }
  });
});
