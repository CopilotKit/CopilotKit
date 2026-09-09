/**
 * The per-lane CHANGELOG.md files: how a release's notes get source-controlled,
 * and how the publish job reads them back.
 *
 * One file per release lane, because the lanes version independently — a shared
 * file would interleave `1.70.0`, `angular/0.5.0` and `channels/0.9.0` into one
 * unreadable sequence.
 *
 * The flow is: prepare-release writes the raw notes, generate-ai-release-notes
 * polishes them, write-changelog prepends them here as a new section, the
 * release PR commits the file, and extract-release-notes reads the section back
 * on the publish side as the GitHub Release body. The changelog is therefore
 * both the durable record and the review surface: editing a section on the
 * release branch changes what ships.
 */

import fs from "fs";
import path from "path";
import { ROOT, getScopeConfig } from "./config.js";
import type { ReleaseScope } from "./config.js";

/**
 * Repo-relative changelog path per lane, keyed by the scope names in
 * release.config.json. Adding a scope there without adding it here is a type
 * error, and `changelog-lanes.test.ts` asserts each file exists and is tracked.
 */
export const CHANGELOG_PATHS: Record<ReleaseScope, string> = {
  monorepo: "CHANGELOG.md",
  angular: "packages/angular/CHANGELOG.md",
  channels: "packages/channels/CHANGELOG.md",
};

export function changelogPathForScope(scope: ReleaseScope): string {
  // Fails loudly on an unknown scope rather than returning undefined.
  getScopeConfig(scope);
  return CHANGELOG_PATHS[scope];
}

export function absoluteChangelogPath(scope: ReleaseScope): string {
  return path.join(ROOT, changelogPathForScope(scope));
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Split into lines, marking the ones inside a fenced code block.
 *
 * Release notes carry shell snippets, and a `## ` line inside a fence is a
 * comment, not a section boundary. Without this, one migration note containing
 * `## step 2` truncates the section around it.
 */
function linesWithFenceState(
  text: string,
): { line: string; fenced: boolean }[] {
  let fenced = false;
  return text.split(/\r?\n/).map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      const wasFenced = fenced;
      fenced = !fenced;
      // The fence line itself belongs to the block it opens or closes.
      return { line, fenced: wasFenced || fenced };
    }
    return { line, fenced };
  });
}

function isSectionHeading(line: string): boolean {
  return /^##\s+\S/.test(line);
}

/**
 * Drop a leading heading that only restates the version.
 *
 * The raw generator opens with `## v1.70.0`, while the AI path is told to emit
 * no title at all. Stripping just the version heading — rather than any leading
 * heading — keeps notes that legitimately open with `### Features`.
 */
export function stripVersionHeading(notes: string, version: string): string {
  const pattern = new RegExp(
    `^\\s*#{1,3}\\s*v?${escapeForRegExp(version)}\\b.*(?:\\r?\\n|$)`,
  );
  return notes.replace(pattern, "").replace(/^\s*\r?\n/, "");
}

export function formatSection(
  version: string,
  date: string,
  notes: string,
): string {
  const body = stripVersionHeading(notes, version).trim();
  return `## ${version} - ${date}\n\n${body || "No changes."}\n`;
}

/**
 * Insert a section above the newest one, keeping the file's preamble on top.
 *
 * Newest-first is the Keep a Changelog convention, and it is what makes
 * "read the top section" a valid way for the publish job to find this release.
 */
export function prependSection(changelog: string, section: string): string {
  const lines = linesWithFenceState(changelog);
  const firstSection = lines.findIndex(
    (entry) => !entry.fenced && isSectionHeading(entry.line),
  );

  const normalized = section.endsWith("\n") ? section : `${section}\n`;

  if (firstSection === -1) {
    return `${changelog.trimEnd()}\n\n${normalized}`;
  }

  const preamble = lines
    .slice(0, firstSection)
    .map((entry) => entry.line)
    .join("\n")
    .trimEnd();
  const rest = lines
    .slice(firstSection)
    .map((entry) => entry.line)
    .join("\n");

  return `${preamble}\n\n${normalized}\n${rest}`;
}

/**
 * The body of one version's section, heading excluded, or null when the version
 * has no section.
 *
 * Heading excluded because the GitHub Release already carries the version in
 * its title; repeating it in the body renders as a stray duplicate.
 */
export function extractSection(
  changelog: string,
  version: string,
): string | null {
  const heading = new RegExp(`^##\\s+v?${escapeForRegExp(version)}\\b`);
  const lines = linesWithFenceState(changelog);
  const start = lines.findIndex(
    (entry) => !entry.fenced && heading.test(entry.line),
  );
  if (start === -1) return null;

  const body: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const entry = lines[index];
    if (!entry.fenced && isSectionHeading(entry.line)) break;
    body.push(entry.line);
  }

  const text = body.join("\n").trim();
  return text || null;
}

/** Drop a version's section, so a re-run replaces it instead of stacking a duplicate. */
export function removeSection(changelog: string, version: string): string {
  const heading = new RegExp(`^##\\s+v?${escapeForRegExp(version)}\\b`);
  const lines = linesWithFenceState(changelog);
  const start = lines.findIndex(
    (entry) => !entry.fenced && heading.test(entry.line),
  );
  if (start === -1) return changelog;

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const entry = lines[index];
    if (!entry.fenced && isSectionHeading(entry.line)) {
      end = index;
      break;
    }
  }

  const kept = [...lines.slice(0, start), ...lines.slice(end)].map(
    (entry) => entry.line,
  );
  return `${kept.join("\n").trimEnd()}\n`;
}

/** Insert this version's section, replacing any section already recorded for it. */
export function upsertSection(
  changelog: string,
  version: string,
  section: string,
): string {
  return prependSection(removeSection(changelog, version), section);
}

export function readChangelog(scope: ReleaseScope): string {
  const file = absoluteChangelogPath(scope);
  if (!fs.existsSync(file)) {
    throw new Error(
      `Changelog not found for scope "${scope}": ${changelogPathForScope(scope)}. ` +
        `Every release lane needs one — see CHANGELOG_PATHS in lib/changelog.ts.`,
    );
  }
  return fs.readFileSync(file, "utf8");
}
