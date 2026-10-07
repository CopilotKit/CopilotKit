import { describe, expect, it } from "vitest";

import docsSearchIndex from "../../data/search-index.json";
import { isChannelDocsHref } from "../search-hrefs";
import { isRouteGroupSegment } from "../route-groups";
import { getSearchablePages, canonicalDocsSlug } from "../searchable-pages";

interface SearchEntry {
  type: string;
  title: string;
  href: string;
}

const docsEntries = docsSearchIndex as SearchEntry[];

const SHOWCASE_HOST_DESTINATIONS = ["/", "/integrations", "/matrix"];

function docsPageEntries(entries: SearchEntry[]): SearchEntry[] {
  return entries.filter((entry) => entry.href.startsWith("/docs"));
}

describe("generated docs search index", () => {
  it("offers no destination that would take a redirect hop", () => {
    const withRouteGroup = docsEntries.filter((entry) =>
      entry.href.split("/").some(isRouteGroupSegment),
    );

    expect(withRouteGroup.map((entry) => entry.href)).toEqual([]);
  });

  it("never sends two docs rows to the same place", () => {
    const byHref = new Map<string, SearchEntry[]>();
    for (const entry of docsPageEntries(docsEntries)) {
      byHref.set(entry.href, [...(byHref.get(entry.href) ?? []), entry]);
    }
    const duplicated = [...byHref]
      .filter(([, group]) => group.length > 1)
      .map(([href]) => href);

    expect(duplicated).toEqual([]);
  });

  it("never sends two rows of any kind to the same place", () => {
    const seen = new Map<string, number>();
    for (const entry of docsEntries) {
      seen.set(entry.href, (seen.get(entry.href) ?? 0) + 1);
    }

    expect(
      [...seen].filter(([, count]) => count > 1).map(([href]) => href),
    ).toEqual([]);
  });

  it("leaves the docs for no showcase-host destination", () => {
    const leaving = docsEntries.filter((entry) =>
      SHOWCASE_HOST_DESTINATIONS.includes(entry.href),
    );

    expect(leaving.map((entry) => entry.href)).toEqual([]);
  });

  it("offers only docs pages a reader can reach from some sidebar", () => {
    const searchable = getSearchablePages();
    const unreachable = docsPageEntries(docsEntries)
      .filter((entry) => !isChannelDocsHref(entry.href))
      .filter((entry) => !entry.href.startsWith("/docs/frontends/"))
      .filter((entry) => !searchable.slugs.has(canonicalDocsSlug(entry.href)));

    expect(unreachable.map((entry) => entry.href)).toEqual([]);
  });
});
