/**
 * Emit the searchable-pages decision as JSON, from inside shell-docs.
 *
 * `generate-search-index.ts` lives in `showcase/scripts` and is invoked
 * from several app directories (shell-docs locally and in its Docker
 * build, shell in its own build and in Validate Showcase). The reachability
 * rules it needs live in shell-docs and pull in shell-docs' own
 * dependencies (`gray-matter`) and its `@/…` path alias. Neither survives
 * being imported from another directory: tsx fixes path-alias resolution
 * from the tsconfig it finds at startup, and Node resolves a dependency
 * from the importing package's tree — so an import that works from
 * shell-docs fails from `scripts` with a missing alias and from `shell`
 * with a missing `gray-matter`.
 *
 * A subprocess sidesteps both. Run here, with shell-docs as the working
 * directory, the alias resolves against shell-docs' tsconfig and the
 * dependencies resolve against shell-docs' node_modules. The generator
 * spawns this script and reads the JSON back, so the two packages share
 * one source of truth without sharing a module graph.
 *
 * Usage: tsx scripts/emit-searchable-pages.ts <output-path>
 */

import fs from "fs";
import path from "path";

import {
  buildCanonicalSlugMap,
  getSearchablePages,
} from "../src/lib/searchable-pages";

const CONTENT_DIR = path.join(process.cwd(), "src/content/docs");

function main() {
  const outputPath = process.argv[2];
  if (!outputPath) {
    console.error(
      "[emit-searchable-pages] missing output path argument\n" +
        "Usage: tsx scripts/emit-searchable-pages.ts <output-path>",
    );
    process.exit(1);
  }

  const pages = getSearchablePages();

  // Sets do not survive JSON, so every collection crosses the process
  // boundary as a sorted array. Sorting keeps the payload stable between
  // runs, which makes a diff of it meaningful when debugging a build.
  const payload = {
    slugs: [...pages.slugs].sort(),
    navTitles: Object.fromEntries([...pages.navTitles.entries()].sort()),
    fromNavigation: [...pages.fromNavigation].sort(),
    fromLinks: [...pages.fromLinks].sort(),
    forcedIn: [...pages.forcedIn].sort(),
    forcedOut: [...pages.forcedOut].sort(),
    // Canonicalization travels as data so the generator never has to import
    // it across the package boundary.
    canonicalBySlug: Object.fromEntries(
      [...buildCanonicalSlugMap(CONTENT_DIR).entries()].sort(),
    ),
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload) + "\n");

  console.log(
    `[emit-searchable-pages] ${payload.slugs.length} searchable slugs ` +
      `(${payload.fromNavigation.length} from navigation, ` +
      `${payload.fromLinks.length} from an inbound link, ` +
      `${payload.forcedIn.length} forced in, ${payload.forcedOut.length} forced out)`,
  );
}

main();
