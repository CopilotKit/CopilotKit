import type { ChangesSummary, Commit } from "./changes.js";
import type { ReleaseScope } from "./config.js";

const BREAKING_CHANGE_MARKER = /^BREAKING(?: CHANGE|-CHANGE):[ \t]*(.*)$/;
const BREAKING_SUBJECT = /^[a-z0-9-]+(?:\([^)]+\))?!:/i;
const TRAILER = /^[a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*)?:[ \t]+/i;

export function extractBreakingChangeNotes(commit: Commit): string[] {
  const lines = commit.body.split(/\r?\n/);
  const notes: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const marker = BREAKING_CHANGE_MARKER.exec(lines[index]);
    if (!marker) continue;

    const noteLines = [marker[1]];
    while (
      index + 1 < lines.length &&
      lines[index + 1].trim() !== "" &&
      !TRAILER.test(lines[index + 1])
    ) {
      index += 1;
      noteLines.push(lines[index].trimEnd());
    }

    const note = noteLines.join("\n").trim();
    if (note) notes.push(note);
  }

  return notes;
}

function isBreakingCommit(commit: Commit): boolean {
  return (
    BREAKING_SUBJECT.test(commit.subject) ||
    extractBreakingChangeNotes(commit).length > 0
  );
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

  for (const commit of summary.commits) {
    if (/^feat[:(]/.test(commit.subject)) features.push(commit);
    else if (/^fix[:(]/.test(commit.subject)) fixes.push(commit);
    else other.push(commit);
  }

  if (features.length > 0) {
    lines.push("### Features", "");
    for (const commit of features) {
      lines.push(`- ${commit.subject} (${commit.hash.slice(0, 7)})`);
    }
    lines.push("");
  }

  if (fixes.length > 0) {
    lines.push("### Fixes", "");
    for (const commit of fixes) {
      lines.push(`- ${commit.subject} (${commit.hash.slice(0, 7)})`);
    }
    lines.push("");
  }

  if (other.length > 0) {
    lines.push("### Other Changes", "");
    for (const commit of other) {
      lines.push(`- ${commit.subject} (${commit.hash.slice(0, 7)})`);
    }
    lines.push("");
  }

  const breakingCommits = summary.commits.filter(isBreakingCommit);
  if (breakingCommits.length > 0) {
    lines.push("### Breaking Changes", "");
    for (const commit of breakingCommits) {
      lines.push(`- ${commit.subject} (${commit.hash.slice(0, 7)})`);
      for (const note of extractBreakingChangeNotes(commit)) {
        const [firstLine, ...continuation] = note.split(/\r?\n/);
        lines.push(`  ${firstLine}`);
        for (const line of continuation) lines.push(`  ${line}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
