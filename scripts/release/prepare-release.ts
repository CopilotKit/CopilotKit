/**
 * Prepare a release: bump versions, generate raw release notes.
 * Runs inside the "create release PR" workflow.
 *
 * Usage: tsx scripts/release/prepare-release.ts --bump <patch|minor|major> [--dry-run]
 */

import fs from "fs";
import path from "path";
import {
  getCurrentVersion,
  computeNextStableVersion,
  bumpVersionedTogetherPackages,
  getPublishablePackages,
  type BumpLevel,
} from "./lib/versions.js";
import {
  getChangesSummary,
  type ChangesSummary,
  type Commit,
} from "./lib/changes.js";
import { ROOT } from "./lib/config.js";

function generateRawReleaseNotes(
  version: string,
  summary: ChangesSummary,
): string {
  const lines: string[] = [];
  lines.push(`## v${version}`, "");

  if (summary.commits.length === 0) {
    lines.push("No changes since last release.");
    return lines.join("\n");
  }

  const features: Commit[] = [];
  const fixes: Commit[] = [];
  const other: Commit[] = [];

  for (const c of summary.commits) {
    if (/^feat[:(]/.test(c.subject)) features.push(c);
    else if (/^fix[:(]/.test(c.subject)) fixes.push(c);
    else other.push(c);
  }

  if (features.length > 0) {
    lines.push("### Features", "");
    for (const c of features)
      lines.push(`- ${c.subject} (${c.hash.slice(0, 7)})`);
    lines.push("");
  }

  if (fixes.length > 0) {
    lines.push("### Fixes", "");
    for (const c of fixes) lines.push(`- ${c.subject} (${c.hash.slice(0, 7)})`);
    lines.push("");
  }

  if (other.length > 0) {
    lines.push("### Other Changes", "");
    for (const c of other) lines.push(`- ${c.subject} (${c.hash.slice(0, 7)})`);
    lines.push("");
  }

  return lines.join("\n");
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const bumpIdx = argv.indexOf("--bump");
  const bumpLevel = (
    bumpIdx !== -1 ? argv[bumpIdx + 1] : null
  ) as BumpLevel | null;

  if (!bumpLevel || !["patch", "minor", "major"].includes(bumpLevel)) {
    console.error("Usage: prepare-release.ts --bump <patch|minor|major>");
    process.exit(1);
  }

  const currentVersion = getCurrentVersion();
  const nextVersion = computeNextStableVersion(currentVersion, bumpLevel);
  console.log(`Current version: ${currentVersion}`);
  console.log(`Bump level: ${bumpLevel}`);
  console.log(`Next version: ${nextVersion}`);

  const summary = getChangesSummary();
  console.log(
    `\nCommits since ${summary.lastTag || "beginning"}: ${summary.commitCount}`,
  );

  if (dryRun) {
    console.log("\n[DRY RUN] Would bump these packages:");
    for (const p of getPublishablePackages().filter(
      (p) => p.isVersionedTogether,
    )) {
      console.log(`  ${p.name}: ${p.pkg.version} -> ${nextVersion}`);
    }
    console.log("\n[DRY RUN] Exiting.");
    return;
  }

  const updated = bumpVersionedTogetherPackages(nextVersion);
  console.log(`\nBumped ${updated.length} packages to ${nextVersion}`);

  const rawNotes = generateRawReleaseNotes(nextVersion, summary);
  const releaseNotesPath = path.join(ROOT, "release-notes.md");
  fs.writeFileSync(releaseNotesPath, rawNotes);
  console.log("Raw release notes written to release-notes.md");

  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    fs.appendFileSync(outputPath, `version=${nextVersion}\n`);
    fs.appendFileSync(outputPath, `tag=v${nextVersion}\n`);
  }

  console.log(`\nRelease prepared: v${nextVersion}`);
}

main();
