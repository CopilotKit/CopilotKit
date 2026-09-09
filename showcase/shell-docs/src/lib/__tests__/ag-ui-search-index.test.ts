import { describe, expect, it } from "vitest";

import searchIndex from "@/data/search-index.json";

interface SearchEntry {
  type: string;
  title: string;
  subtitle: string;
  section: string;
  href: string;
}

const entries = searchIndex as SearchEntry[];
const hrefs = new Set(entries.map((entry) => entry.href));

describe("AG-UI entries in the docs search index", () => {
  // /ag-ui/development/updates is titled "What's New", holds a single entry
  // from April 2025, and throws on render because it uses an <Update>
  // component this app does not provide. It is vendored AG-UI content whose
  // canonical home is docs.ag-ui.com, so it is unlinked rather than edited.
  it("does not offer the broken AG-UI What's New page", () => {
    expect(hrefs.has("/ag-ui/development/updates")).toBe(false);
  });

  it("still offers the AG-UI pages next to it in the sidebar", () => {
    expect(hrefs.has("/ag-ui/development/roadmap")).toBe(true);
    expect(hrefs.has("/ag-ui/development/contributing")).toBe(true);
  });

  it("keeps the rest of the AG-UI section searchable", () => {
    const aguiEntries = entries.filter((entry) =>
      entry.href.startsWith("/ag-ui"),
    );
    // A guard against silently emptying the AG-UI portion: the published
    // slug list is hand-maintained, and a typo there should fail loudly.
    expect(aguiEntries.length).toBeGreaterThan(30);
  });
});
