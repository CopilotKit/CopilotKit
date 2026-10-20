/**
 * Record this release's notes in its lane's CHANGELOG.md.
 *
 * Runs in the "create release PR" workflow, after generate-ai-release-notes.ts
 * has polished release-notes.md. The changelog is the committed artifact:
 * release-notes.md itself stays untracked scratch on both sides of the lane.
 *
 * Usage: tsx scripts/release/write-changelog.ts <version> <scope>
 */

import fs from "fs";
import path from "path";
import { ROOT, loadConfig } from "./lib/config.js";
import type { ReleaseScope } from "./lib/config.js";
import {
  absoluteChangelogPath,
  changelogPathForScope,
  formatSection,
  readChangelog,
  upsertSection,
} from "./lib/changelog.js";

function main() {
  const version = process.argv[2];
  const scope = process.argv[3] as ReleaseScope | undefined;
  const validScopes = Object.keys(loadConfig().scopes);

  if (!version || !scope || !validScopes.includes(scope)) {
    console.error(
      `Usage: write-changelog.ts <version> <scope>\n` +
        `Valid scopes: ${validScopes.join(", ")}`,
    );
    process.exit(1);
  }

  const notesPath = path.join(ROOT, "release-notes.md");
  if (!fs.existsSync(notesPath)) {
    console.error("release-notes.md not found. Run prepare-release.ts first.");
    process.exit(1);
  }

  const notes = fs.readFileSync(notesPath, "utf8");
  // Dated at create-PR time, which is when the notes are written and reviewed.
  const date = new Date().toISOString().slice(0, 10);
  const section = formatSection(version, date, notes);
  const updated = upsertSection(readChangelog(scope), version, section);

  fs.writeFileSync(absoluteChangelogPath(scope), updated);
  console.log(`Recorded ${version} in ${changelogPathForScope(scope)}`);

  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    fs.appendFileSync(
      outputPath,
      `changelog_path=${changelogPathForScope(scope)}\n`,
    );
  }
}

main();
