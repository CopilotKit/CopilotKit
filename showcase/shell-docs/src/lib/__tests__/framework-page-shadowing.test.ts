import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT_DIR } from "../docs-render";
import { getDocsFolder, getDocsMode, getIntegrations } from "../registry";

// Under `docs_mode: generated` the root MDX wins for the page BODY — see the
// resolution order in `src/app/[framework]/[[...slug]]/page.tsx:829` and the
// matching `candidateOrder` in `src/app/llms-mdx/[[...slug]]/route.ts:365`.
// A per-framework file at a slug the root also defines therefore contributes
// no body to either surface.
//
// It is NOT fully inert, though: `frameworkMetadata` (page.tsx:255) loads the
// framework-scoped doc FIRST, with no docsMode branch, so such a file still
// supplies the page's <title>, meta description and OG text. Deleting one whose
// frontmatter differs from the root page changes what that URL reports to
// search engines.
//
// So this is a ratchet, not a clean assertion. BASELINE lists the files that
// still shadow a root page today; every one of them differs from its root twin
// in at least one frontmatter field, and they are blocked on deciding what the
// metadata for those URLs should say. Adding a NEW shadowed file fails here.
// Deleting a baseline entry also fails, so the list cannot drift out of date.
//
// Two slugs are excluded entirely because both routes special-case them so the
// framework copy wins: the root `quickstart` is a routing shim, and
// `threads-import` is a cross-source overview with per-framework guides.
const FRAMEWORK_WINS = new Set(["quickstart", "threads-import"]);

// Empty, and it must stay that way. Every generated-mode framework now takes
// the root page for both body and metadata, so a per-framework file at a slug
// the root also defines is dead in every surface. The 31 that used to sit here
// were deleted once #7207 stopped their frontmatter driving live <title> and
// meta description.
const BASELINE: readonly string[] = [];

function mdxSlugs(dir: string, prefix = ""): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const next = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return mdxSlugs(path.join(dir, entry.name), next);
    return entry.name.endsWith(".mdx") ? [next.replace(/\.mdx$/, "")] : [];
  });
}

describe("generated-mode frameworks do not gain shadowed pages", () => {
  const rootSlugs = new Set(
    mdxSlugs(CONTENT_DIR).filter((slug) => !slug.startsWith("integrations/")),
  );

  // Several integrations share one docs folder, and sharing can MIX modes:
  // `microsoft-agent-framework/` serves ms-agent-dotnet and ms-agent-python
  // (both `authored`, so the per-framework file wins and is very much served)
  // alongside ms-agent-harness-dotnet (`generated`). A file there is therefore
  // live, even though one of its three slugs would resolve past it.
  //
  // So a folder only qualifies when EVERY integration mapping to it is
  // generated-mode. Grouping by folder first — rather than filtering
  // integrations and then mapping to folders — is what makes that check
  // possible; the filter-then-map order silently admits mixed folders.
  const slugsByFolder = new Map<string, string[]>();
  for (const integration of getIntegrations()) {
    const folder = getDocsFolder(integration.slug);
    slugsByFolder.set(folder, [
      ...(slugsByFolder.get(folder) ?? []),
      integration.slug,
    ]);
  }
  const folders = [...slugsByFolder.entries()]
    .filter(([, slugs]) =>
      slugs.every((slug) => getDocsMode(slug) === "generated"),
    )
    .map(([folder]) => folder)
    .sort();

  it("finds generated-mode integrations to check", () => {
    expect(folders.length).toBeGreaterThan(0);
    expect(rootSlugs.size).toBeGreaterThan(0);
  });

  it("matches the recorded baseline exactly", () => {
    const shadowed = folders
      .flatMap((folder) =>
        mdxSlugs(path.join(CONTENT_DIR, "integrations", folder))
          .filter((slug) => rootSlugs.has(slug) && !FRAMEWORK_WINS.has(slug))
          .map((slug) => `${folder}/${slug}`),
      )
      .sort();

    // Named paths on failure, so a regression says which file appeared or
    // disappeared rather than just a count.
    expect(shadowed).toEqual([...BASELINE].sort());
  });
});
