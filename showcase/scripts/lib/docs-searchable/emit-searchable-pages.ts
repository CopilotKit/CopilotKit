/**
 * Emit the searchable-pages decision as JSON.
 *
 * `generate-search-index.ts` needs to know which docs pages a reader can
 * reach from a sidebar, so the showcase shell's header search and the docs
 * agree. These rules came from the first docs app and read the docs content
 * (`shell-docs/src/content`) and the generated registry
 * (`shell-docs/src/data/registry.json`) relative to the working directory, so
 * the generator runs this script as a subprocess with shell-docs as its cwd.
 *
 * Usage: tsx emit-searchable-pages.ts <output-path>
 */

import fs from "fs";
import path from "path";

import { buildCanonicalSlugMap, getSearchablePages } from "./searchable-pages";

const CONTENT_DIR = path.join(process.cwd(), "src/content/docs");

function main() {
  const outputPath = process.argv[2];
  if (!outputPath) {
    console.error(
      "[emit-searchable-pages] missing output path argument\n" +
        "Usage: tsx emit-searchable-pages.ts <output-path>",
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
