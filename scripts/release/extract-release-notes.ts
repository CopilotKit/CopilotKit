/**
 * Read this release's section out of its lane's CHANGELOG.md and write it to
 * release-notes.md, which the publish workflow uses as the GitHub Release body.
 *
 * Runs in the publish job, AFTER npm publish. It therefore never exits non-zero:
 * failing here would leave the packages published but the tag unpushed. A miss
 * is annotated loudly instead, and the workflow's own fallback puts
 * `Release <tag>` in the body.
 *
 * Usage: tsx scripts/release/extract-release-notes.ts <version> <scope>
 */

import fs from "fs";
import path from "path";
import { ROOT, loadConfig } from "./lib/config.js";
import type { ReleaseScope } from "./lib/config.js";
import {
  changelogPathForScope,
  extractSection,
  readChangelog,
} from "./lib/changelog.js";

function annotate(message: string): void {
  console.log(`::error title=Release notes::${message}`);
}

function main() {
  const version = process.argv[2];
  const scope = process.argv[3] as ReleaseScope | undefined;
  const validScopes = Object.keys(loadConfig().scopes);

  if (!version || !scope || !validScopes.includes(scope)) {
    annotate(
      `extract-release-notes.ts needs <version> <scope>, got "${version}" "${scope}". ` +
        `The GitHub Release will fall back to a bodyless "Release <tag>".`,
    );
    return;
  }

  let body: string | null = null;
  try {
    body = extractSection(readChangelog(scope), version);
  } catch (error: any) {
    annotate(`${error.message} Falling back to a bodyless release.`);
    return;
  }

  if (!body) {
    annotate(
      `No section for ${version} in ${changelogPathForScope(scope)}. The release PR ` +
        `should have added one — the GitHub Release will fall back to a bodyless ` +
        `"Release <tag>".`,
    );
    return;
  }

  fs.writeFileSync(path.join(ROOT, "release-notes.md"), `${body}\n`);
  console.log(
    `Release body written to release-notes.md from ${changelogPathForScope(scope)} (${body.length} chars)`,
  );
}

main();
