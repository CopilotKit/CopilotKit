/**
 * Publish a stable release (runs after merge of a release PR).
 *
 * 1. Reads the scope and current version from package.json (already bumped by the release PR)
 * 2. Optionally reads the Notion draft for the final release notes
 * 3. Builds all packages
 * 4. Publishes to npm with "latest" tag
 * 5. Outputs the version for downstream steps (git tag, GitHub Release)
 *
 * Env vars:
 *   NPM_TOKEN        — npm auth token
 *   NOTION_API_KEY    — for reading edited release notes from Notion (optional)
 *   GITHUB_OUTPUT     — CI output file
 *
 * Usage: tsx scripts/release/publish-release.ts --scope <monorepo|angular>
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import {
  getCurrentVersion,
  getPackagesForScope,
  parseSemver,
} from "./lib/versions.js";
import { readReleaseDraft } from "./lib/notion.js";
import { ROOT, getScopeConfig, type ReleaseScope } from "./lib/config.js";

function run(cmd: string, args: string[], opts?: { cwd?: string }) {
  const result = spawnSync(cmd, args, {
    cwd: opts?.cwd ?? ROOT,
    stdio: "inherit",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}`);
  }
  return result;
}

function getPublishedVersion(packageName: string): string | null {
  const result = spawnSync("npm", ["view", packageName, "version"], {
    encoding: "utf8",
    timeout: 15000,
  });
  if (result.status === 0) {
    return result.stdout.trim() || null;
  }
  // E404 means package doesn't exist on registry — genuinely not published
  if (
    result.stderr?.includes("E404") ||
    result.stderr?.includes("is not in this registry")
  ) {
    return null;
  }
  // Any other error (network, auth, rate limit) should stop the release
  throw new Error(
    `npm registry check failed for ${packageName}: ${result.stderr?.trim() || "unknown error"}`,
  );
}

function isGreaterVersion(next: string, current: string): boolean {
  const a = parseSemver(next);
  const b = parseSemver(current);
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch > b.patch;
}

const VALID_SCOPES = ["monorepo", "angular"];

async function main() {
  const argv = process.argv.slice(2);
  const scopeIdx = argv.indexOf("--scope");
  const scope = (
    scopeIdx !== -1 ? argv[scopeIdx + 1] : null
  ) as ReleaseScope | null;

  if (!scope || !VALID_SCOPES.includes(scope)) {
    console.error(
      `Usage: publish-release.ts --scope <${VALID_SCOPES.join("|")}>`,
    );
    process.exit(1);
  }

  const version = getCurrentVersion(scope);
  const scopeConfig = getScopeConfig(scope);
  console.log(`Scope: ${scope}`);
  console.log(`Publishing version: ${version}`);

  // Safety check: only allow clean semver (no prerelease suffixes like -canary.123)
  const v = parseSemver(version);
  if (v.prerelease) {
    console.error(
      `Refusing to publish: ${version} contains a prerelease suffix. ` +
        `Stable releases must be clean semver (e.g. 1.55.3).`,
    );
    process.exit(1);
  }

  // Safety check: refuse to publish if version isn't greater than what's on npm
  let published: string | null;
  try {
    published = getPublishedVersion(scopeConfig.versionSource);
  } catch (err: any) {
    console.error(
      `Registry check failed — aborting release to avoid publishing over an existing version.`,
    );
    console.error(err.message);
    process.exit(1);
  }
  if (published) {
    console.log(`Currently published version: ${published}`);
    if (!isGreaterVersion(version, published)) {
      console.error(
        `Refusing to publish: ${version} is not greater than the currently published ${published}.`,
      );
      process.exit(1);
    }
  }

  // Try to read edited release notes from Notion
  const notionRefPath = path.join(ROOT, "release-notes-notion.json");
  const releaseNotesPath = path.join(ROOT, "release-notes.md");

  if (fs.existsSync(notionRefPath)) {
    try {
      const ref = JSON.parse(fs.readFileSync(notionRefPath, "utf8"));
      if (ref.pageId && process.env.NOTION_API_KEY) {
        console.log("Reading edited release notes from Notion...");
        const notionContent = await readReleaseDraft(ref.pageId);
        if (notionContent.trim()) {
          fs.writeFileSync(releaseNotesPath, notionContent);
          console.log("Release notes updated from Notion draft.");
        }
      }
    } catch (err: any) {
      console.error(`Failed to read Notion draft: ${err.message}`);
      console.log("Using release notes from the PR branch.");
    }
  }

  // Build all packages
  console.log("\nBuilding packages...");
  run("pnpm", ["run", "build"]);

  // Publish each package in scope
  console.log("\nPublishing packages...");
  for (const p of getPackagesForScope(scope)) {
    console.log(`  Publishing ${p.name}@${version}...`);
    run(
      "pnpm",
      ["publish", "--no-git-checks", "--tag", "latest", "--access", "public"],
      { cwd: p.dir },
    );
  }

  // Output version for downstream steps
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    fs.appendFileSync(outputPath, `version=${version}\n`);
    fs.appendFileSync(outputPath, `scope=${scope}\n`);
  }

  console.log(`\nRelease published: ${version} (${scope})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
