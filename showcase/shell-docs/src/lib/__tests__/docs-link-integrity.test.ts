import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDocsFileIndex,
  defaultNavigationSurfaces,
  docsSlugCandidatesFromLinkTarget,
  extractInternalLinkTargets,
} from "../searchable-pages";
import { matchesSeoRedirectSource } from "../seo-redirects";
import { resolveDocsHref } from "../docs-link-rewrite";
import { CONTENT_DIR } from "../docs-render";
import { FRONTEND_PAGE_IDS } from "../frontend-page-content";
import {
  getDocsFolder,
  getDocsMode,
  getIntegrations,
  ROOT_FRAMEWORK,
} from "../registry";

/**
 * Two integrity checks over authored docs content:
 *
 *   1. every `/`-rooted link points at something that resolves;
 *   2. every `meta.json` page entry has a page behind it.
 *
 * Both reuse the app's own resolution rather than reimplementing routing —
 * `docsSlugCandidatesFromLinkTarget` for slug candidates and `resolveDocsHref`
 * for the framework-scope rewrite a reader actually gets. A hand-rolled
 * resolver reports 43 broken links where 8 are real, so the cost of guessing
 * here is a check nobody can trust.
 */

// Same source as the search-index builder: derived, never listed.
const FRONTEND_SEGMENTS: string[] = FRONTEND_PAGE_IDS;
const CONTENT_ROOT = path.resolve(CONTENT_DIR, "..");
const PUBLIC_DIR = path.resolve(CONTENT_DIR, "../../../public");

/**
 * Link targets that do not resolve today. This list only ever shrinks: adding
 * an entry needs a reason, removing one needs only a fix. Each is a real
 * defect, not an exemption — see the notes.
 */
const KNOWN_BROKEN_LINKS: ReadonlyArray<readonly [string, string]> = [
  [
    "/agentcore/full-stack-example",
    "no such page anywhere in the content tree",
  ],
  [
    "/custom-look-and-feel/bring-your-own-components",
    "exists only as a snippet, which is not routable",
  ],
  [
    "/generative-ui/your-components",
    "directory has display-only.mdx and interactive.mdx but no index.mdx",
  ],
  [
    "/shared-state/in-app-agent-read",
    "exists per framework, not on the root surface",
  ],
];

/** `meta.json` entries with no page behind them. Shrink-only, as above. */
const KNOWN_MISSING_META_PAGES: ReadonlyArray<readonly [string, string]> = [
  [
    "docs -> index",
    "the site root is rendered by app code, not by an MDX file",
  ],
  [
    "docs/integrations/a2a -> index",
    "sidebar opens with an entry that has no file",
  ],
  [
    "docs/integrations/adk -> index",
    "sidebar opens with an entry that has no file",
  ],
  [
    "docs/integrations/agent-spec -> index",
    "sidebar opens with an entry that has no file",
  ],
];

function allMdx(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".mdx")) out.push(p);
    }
  };
  walk(dir);
  return out;
}

function allMetaJson(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name === "meta.json") out.push(p);
    }
  };
  walk(dir);
  return out;
}

describe("every internal docs link resolves", () => {
  const fileIndex = buildDocsFileIndex(CONTENT_DIR);
  const scopeFolders = new Map<string, string>();
  for (const segment of FRONTEND_SEGMENTS) scopeFolders.set(segment, "");
  for (const surface of defaultNavigationSurfaces(CONTENT_DIR)) {
    if (!surface.routeScope) continue;
    scopeFolders.set(surface.routeScope, surface.integrationFolder ?? "");
  }
  const folderForScope = (segment: string) => scopeFolders.get(segment) ?? null;
  const rootFolder = getDocsFolder(ROOT_FRAMEWORK);

  function resolves(href: string): boolean {
    const bare = href.split("#")[0].split("?")[0];
    if (fs.existsSync(path.join(PUBLIC_DIR, bare))) return true;
    if (matchesSeoRedirectSource(bare)) return true;

    const segments = bare.split("/").filter(Boolean);
    // Frontend surfaces are routed at `/<frontend>/<topic>`.
    if (
      segments.length > 0 &&
      FRONTEND_SEGMENTS.includes(segments[0]) &&
      fileIndex.has(`frontends/${segments.join("/")}`)
    ) {
      return true;
    }
    // Channel frontends route their landing page at `/<frontend>/connect`.
    if (
      segments.length === 2 &&
      ["slack", "teams"].includes(segments[0]) &&
      segments[1] === "connect" &&
      fileIndex.has(`frontends/${segments[0]}`)
    ) {
      return true;
    }

    const candidates = docsSlugCandidatesFromLinkTarget(bare, folderForScope);
    if (candidates.includes("")) return true; // the docs root itself
    // `/reference`, `/ag-ui`, `/matrix`, `/api` are other routes entirely.
    if (candidates.length === 0) return true;
    if (candidates.some((c) => c !== "" && fileIndex.has(c))) return true;
    // The unscoped surface is the root framework's surface.
    return candidates.some(
      (c) => c !== "" && fileIndex.has(`integrations/${rootFolder}/${c}`),
    );
  }

  const slugForFolder = new Map<string, string>();
  for (const integration of getIntegrations()) {
    if (getDocsMode(integration.slug) === "hidden") continue;
    const folder = getDocsFolder(integration.slug);
    if (!slugForFolder.has(folder)) slugForFolder.set(folder, integration.slug);
  }

  const files = [
    ...allMdx(CONTENT_DIR),
    ...allMdx(path.join(CONTENT_ROOT, "snippets")),
  ];

  const unresolved = new Map<string, Set<string>>();
  let checked = 0;
  for (const file of files) {
    const rel = path.relative(CONTENT_ROOT, file);
    const owner = rel.match(/^docs\/integrations\/([^/]+)\//);
    const scope = owner ? slugForFolder.get(owner[1]) : undefined;
    const source = fs.readFileSync(file, "utf8");
    for (const target of new Set(extractInternalLinkTargets(source))) {
      checked++;
      if (resolves(target)) continue;
      // A page inside a framework's folder is read under that framework's
      // scope, so its bare links are rewritten before the reader sees them.
      let rewritten = target;
      try {
        rewritten =
          resolveDocsHref(target, {
            slugHrefPrefix: scope ? `/${scope}` : "",
            frameworkOverride: scope ?? null,
          }) ?? target;
      } catch {
        // resolveDocsHref refused this shape; judge the raw target instead.
      }
      if (rewritten !== target && resolves(rewritten)) continue;
      if (!unresolved.has(target)) unresolved.set(target, new Set());
      unresolved.get(target)!.add(rel);
    }
  }

  const known = new Map(KNOWN_BROKEN_LINKS.map(([t, why]) => [t, why]));

  it("walks a meaningful number of links", () => {
    expect(checked).toBeGreaterThan(500);
    expect(files.length).toBeGreaterThan(400);
  });

  it("has no unresolved link outside the known-broken list", () => {
    const fresh = [...unresolved.entries()]
      .filter(([target]) => !known.has(target.split("#")[0]))
      .map(
        ([target, sources]) => `${target}  (from ${[...sources].sort()[0]})`,
      );
    expect(fresh.sort()).toEqual([]);
  });

  it("keeps the known-broken list honest — every entry is still broken here", () => {
    // Stricter than "does it resolve": an entry also rots when the last link
    // to it is deleted or repointed, which leaves the list describing a
    // target nothing references any more.
    const stale = [...known.keys()].filter((target) => !unresolved.has(target));
    expect(stale.sort()).toEqual([]);
  });
});

describe("every meta.json page entry has a page", () => {
  const isDir = (p: string) => fs.existsSync(p) && fs.statSync(p).isDirectory();
  // An entry resolves to a page file, an index page, or a folder group — a
  // directory whose own meta.json supplies the children.
  const resolvesIn = (dir: string, name: string) =>
    fs.existsSync(path.join(dir, `${name}.mdx`)) ||
    fs.existsSync(path.join(dir, name, "index.mdx")) ||
    isDir(path.join(dir, name));

  const missing: string[] = [];
  let entries = 0;
  for (const metaPath of allMetaJson(path.join(CONTENT_ROOT))) {
    let meta: { pages?: unknown[] };
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    } catch {
      continue; // a malformed meta.json is a different test's problem
    }
    const dir = path.dirname(metaPath);
    const rel = path.relative(CONTENT_ROOT, dir);
    // Under `docs_mode: generated` a framework surface inherits the shared
    // root page of the same name, so that is a legitimate destination too.
    const owner = rel.match(/^docs\/integrations\/[^/]+(?:\/(.*))?$/);
    const sharedDir = owner
      ? path.join(CONTENT_ROOT, "docs", owner[1] ?? "")
      : null;

    const visit = (pages: unknown[] | undefined) => {
      for (const item of pages ?? []) {
        if (typeof item === "object" && item !== null) {
          visit((item as { pages?: unknown[] }).pages);
          continue;
        }
        if (typeof item !== "string") continue;
        if (/^---.*---$/.test(item)) continue; // separator
        if (item.startsWith("...")) continue; // directory spread
        entries++;
        if (resolvesIn(dir, item)) continue;
        if (sharedDir && resolvesIn(sharedDir, item)) continue;
        missing.push(`${rel} -> ${item}`);
      }
    };
    visit(meta.pages);
  }

  const known = new Set(KNOWN_MISSING_META_PAGES.map(([entry]) => entry));

  it("walks a meaningful number of entries", () => {
    expect(entries).toBeGreaterThan(400);
  });

  it("has no missing page outside the known list", () => {
    expect(missing.filter((m) => !known.has(m)).sort()).toEqual([]);
  });

  it("keeps the known list honest — no entry that already resolves", () => {
    expect([...known].filter((k) => !missing.includes(k)).sort()).toEqual([]);
  });
});
