import fs from "node:fs";
import path from "node:path";

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

// The showcase app's copy of the index. Read from disk rather than
// imported so this suite still runs in a checkout where only shell-docs
// has been generated.
const SHELL_INDEX_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "shell",
  "src",
  "data",
  "search-index.json",
);

function readShellIndex(): SearchEntry[] | null {
  if (!fs.existsSync(SHELL_INDEX_PATH)) return null;
  return JSON.parse(fs.readFileSync(SHELL_INDEX_PATH, "utf-8"));
}

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

  it("drops the What's New roll-up page the maintained announcements replaced", () => {
    expect(docsEntries.some((entry) => entry.href === "/docs/whats-new")).toBe(
      false,
    );
  });

  it("keeps an unlisted page whose only inbound link lives in a snippet", () => {
    // `intelligence/headless-ui` is in no sidebar. It stays searchable
    // because the Intelligence overview links to it — and that page's
    // whole body is `<Overview />`, so the link is only visible once the
    // snippet is inlined. This asserts the real resolution, which is why
    // the page needs no `search: true` override.
    const searchable = getSearchablePages();

    expect(searchable.fromNavigation.has("intelligence/headless-ui")).toBe(
      false,
    );
    expect(searchable.fromLinks.has("intelligence/headless-ui")).toBe(true);
    expect(
      docsEntries.some(
        (entry) => entry.href === "/docs/intelligence/headless-ui",
      ),
    ).toBe(true);
  });

  it("needs no frontmatter override to reach its current coverage", () => {
    // The escape hatch should stay rare: a mechanism proven by the rules
    // beats one proven by a manual override. If a page legitimately needs
    // `search: true` later, update this expectation deliberately.
    expect([...getSearchablePages().forcedIn]).toEqual([]);
  });

  it("keeps the channel guides the modal re-routes at runtime", () => {
    const channels = docsEntries.filter((entry) =>
      isChannelDocsHref(entry.href),
    );

    // Filtering these against the docs navigation would wrongly delete
    // them: `parseChannelDocsHref` turns each into a Slack and a Teams
    // destination when the result list is built.
    expect(channels.length).toBeGreaterThan(0);
    expect(channels.map((entry) => entry.href)).toContain("/docs/channels");
  });

  it("keeps integration pages under the folder form the modal parses", () => {
    const integrationEntries = docsPageEntries(docsEntries).filter((entry) =>
      entry.href.startsWith("/docs/integrations/"),
    );

    expect(integrationEntries.length).toBeGreaterThan(0);
    expect(integrationEntries.map((entry) => entry.href)).toContain(
      "/docs/integrations/langgraph/threads",
    );
  });

  it("holds enough docs pages that a broken navigation walk cannot pass", () => {
    // Mirrors MIN_DOCS_ENTRIES in showcase/scripts/generate-search-index.ts.
    expect(docsPageEntries(docsEntries).length).toBeGreaterThanOrEqual(495);
  });
});

describe("generated showcase search index", () => {
  it("keeps the integrations explorer and feature matrix the showcase owns", () => {
    const shellIndex = readShellIndex();
    if (shellIndex === null) return;

    const hrefs = shellIndex.map((entry) => entry.href);
    expect(hrefs).toContain("/integrations");
    expect(hrefs).toContain("/matrix");
    expect(hrefs).toContain("/");
  });

  it("agrees with the docs index on everything but the showcase rows", () => {
    const shellIndex = readShellIndex();
    if (shellIndex === null) return;

    const onlyInShell = shellIndex
      .filter(
        (entry) =>
          !docsEntries.some((docsEntry) => docsEntry.href === entry.href),
      )
      .map((entry) => entry.href)
      .sort();

    expect(onlyInShell).toEqual([...SHOWCASE_HOST_DESTINATIONS].sort());
  });
});
