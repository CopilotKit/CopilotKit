import type { ChangesSummary, Commit } from "./changes.js";
import type { ReleaseScope } from "./config.js";

const BREAKING_CHANGE_MARKER = /^BREAKING[ -]CHANGE:\s*/m;

export function extractBreakingChangeNotes(commit: Commit): string[] {
  const match = BREAKING_CHANGE_MARKER.exec(commit.body);
  if (!match) return [];

  const lines = commit.body.slice(match.index).split(/\r?\n/);
  const paragraph: string[] = [lines[0].replace(BREAKING_CHANGE_MARKER, "")];
  for (const line of lines.slice(1)) {
    // Stop at the next footer/trailer (e.g. Co-authored-by, Refs).
    if (/^[A-Za-z][A-Za-z-]*:/.test(line)) break;
    paragraph.push(line.trimEnd());
  }

  const note = paragraph.join("\n").trim();
  return note.length > 0 ? [note] : [];
}

export function generateRawReleaseNotes(
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

  const breakingChanges = summary.commits.flatMap(extractBreakingChangeNotes);
  if (breakingChanges.length > 0) {
    lines.push("### Breaking Changes", "");
    for (const note of breakingChanges) {
      const noteLines = note.split(/\r?\n/);
      lines.push(`- ${noteLines[0]}`);
      for (const continuation of noteLines.slice(1)) {
        lines.push(`  ${continuation}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}