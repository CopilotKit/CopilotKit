import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  INTELLIGENCE_SEARCH_CTAS,
  buildTrackedInternalDocsHref,
  matchIntelligenceSearchCta,
  matchedKeywordFor,
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
      expect(cta.secondary.length).toBeGreaterThanOrEqual(2);
      expect(cta.secondary.length).toBeLessThanOrEqual(3);
      for (const link of [cta.primary, ...cta.secondary]) {
        expect(link.label.trim().length).toBeGreaterThan(0);
      }
      expect(cta.title.trim().length).toBeGreaterThan(0);
      expect(cta.body.trim().length).toBeGreaterThan(0);
    }
  });

  it("keeps the threads copy honest about what is paid", () => {
    const threads = matchIntelligenceSearchCta("threads");
    const copy = `${threads?.title} ${threads?.body}`.toLowerCase();

    // Threads themselves are open source and free; Intelligence adds the
    // durable storage behind them. The copy must not imply otherwise.
    expect(copy).toContain("built into copilotkit");
    expect(copy).toMatch(/resume|resumable/);
    expect(copy).not.toMatch(/upgrade to|paid|pro plan|premium/);
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

  it("returns the most specific entry when several match, and only one", () => {
    expect(matchIntelligenceSearchCta("intelligence threads")?.id).toBe(
      "threads",
    );
    expect(matchIntelligenceSearchCta("threads intelligence")?.id).toBe(
      "threads",
    );
    expect(
      matchIntelligenceSearchCta("intelligence analytics learning")?.id,
    ).not.toBe("intelligence");

    // The API is single-valued by construction: there is no shape in
    // which two blocks could render.
    const match = matchIntelligenceSearchCta("intelligence threads");
    expect(Array.isArray(match)).toBe(false);
    expect(match).not.toBeNull();
  });

  it("declares specificity as data rather than inferring it", () => {
    const byId = new Map(ALL_ENTRIES.map((cta) => [cta.id, cta.specificity]));
    expect(byId.get("threads")).toBeGreaterThan(byId.get("self-hosting")!);
    expect(byId.get("self-hosting")).toBeGreaterThan(byId.get("learning")!);
    expect(byId.get("learning")).toBeGreaterThan(byId.get("intelligence")!);
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

  it("reports which keyword fired", () => {
    const threads = matchIntelligenceSearchCta("persistence")!;
    expect(matchedKeywordFor(threads, "persistence")).toBe("persistence");
    expect(matchedKeywordFor(threads, "threads")).toBe("threads");
  });
});

describe("Intelligence search CTA attribution", () => {
  it("keeps the destination internal while carrying docs CTA attribution", () => {
    const href = buildTrackedInternalDocsHref("/intelligence/overview", {
      surface: "docs-search:intelligence:intelligence",
      frontend: "angular",
      backend: "langgraph-python",
    });

    expect(href.startsWith("/intelligence/overview?")).toBe(true);
    expect(href).not.toMatch(/^(https?:)?\/\//);
    expect(href).not.toContain("invalid");

    const params = new URLSearchParams(href.slice(href.indexOf("?")));
    expect(params.get("utm_source")).toBe("docs");
    expect(params.get("utm_medium")).toBe("cta");
    expect(params.get("utm_campaign")).toBe("intelligence");
    expect(params.get("utm_content")).toBe(
      "docs-search:intelligence:intelligence",
    );
    expect(params.get("utm_frontend")).toBe("angular");
    expect(params.get("utm_backend")).toBe("langgraph-python");
  });

  it("names search and the matched keyword in the surface", () => {
    const href = buildTrackedInternalDocsHref("/threads", {
      surface: "docs-search:threads:persistence",
    });
    const params = new URLSearchParams(href.slice(href.indexOf("?")));

    expect(params.get("utm_content")).toBe("docs-search:threads:persistence");
  });
});
