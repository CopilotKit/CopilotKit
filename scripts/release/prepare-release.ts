/**
 * Prepare a release: bump versions, generate raw release notes.
 * Runs inside the "create release PR" workflow.
 *
 * Usage: tsx scripts/release/prepare-release.ts --bump <patch|minor|major> --scope <monorepo|angular> [--dry-run]
 */

import fs from "fs";
import path from "path";
import {
  getCurrentVersion,
  computeNextStableVersion,
  bumpPackages,
  getPackagesForScope,
  type BumpLevel,
} from "./lib/versions.js";
import {
  getChangesSummary,
  type ChangesSummary,
  type Commit,
} from "./lib/changes.js";
import { ROOT, type ReleaseScope } from "./lib/config.js";

function generateRawReleaseNotes(
  version: string,
  scope: ReleaseScope,
  summary: ChangesSummary,
): string {
  const lines: string[] = [];
  const label = scope === "monorepo" ? "" : ` (${scope})`;
  lines.push(`## v${version}${label}`, "");

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

const VALID_SCOPES = ["monorepo", "angular"];

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const bumpIdx = argv.indexOf("--bump");
  const bumpLevel = (
    bumpIdx !== -1 ? argv[bumpIdx + 1] : null
  ) as BumpLevel | null;
  const scopeIdx = argv.indexOf("--scope");
  const scope = (
    scopeIdx !== -1 ? argv[scopeIdx + 1] : null
  ) as ReleaseScope | null;

  if (!bumpLevel || !["patch", "minor", "major"].includes(bumpLevel)) {
    console.error(
      "Usage: prepare-release.ts --bump <patch|minor|major> --scope <monorepo|angular>",
    );
    process.exit(1);
  }

  if (!scope || !VALID_SCOPES.includes(scope)) {
    console.error(
      `Invalid scope: ${scope}. Valid scopes: ${VALID_SCOPES.join(", ")}`,
    );
    process.exit(1);
  }

  const currentVersion = getCurrentVersion(scope);
  const nextVersion = computeNextStableVersion(currentVersion, bumpLevel);
  console.log(`Scope: ${scope}`);
  console.log(`Current version: ${currentVersion}`);
  console.log(`Bump level: ${bumpLevel}`);
  console.log(`Next version: ${nextVersion}`);

  const summary = getChangesSummary();
  console.log(
    `\nCommits since ${summary.lastTag || "beginning"}: ${summary.commitCount}`,
  );

  if (dryRun) {
    console.log("\n[DRY RUN] Would bump these packages:");
    for (const p of getPackagesForScope(scope)) {
      console.log(`  ${p.name}: ${p.pkg.version} -> ${nextVersion}`);
    }
    console.log("\n[DRY RUN] Exiting.");
    return;
  }

  const updated = bumpPackages(scope, nextVersion);
  console.log(`\nBumped ${updated.length} packages to ${nextVersion}`);

  const rawNotes = generateRawReleaseNotes(nextVersion, scope, summary);
  const releaseNotesPath = path.join(ROOT, "release-notes.md");
  fs.writeFileSync(releaseNotesPath, rawNotes);
  console.log("Raw release notes written to release-notes.md");

  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    fs.appendFileSync(outputPath, `version=${nextVersion}\n`);
    fs.appendFileSync(outputPath, `scope=${scope}\n`);
  }

  console.log(`\nRelease prepared: v${nextVersion} (${scope})`);
}

main();
