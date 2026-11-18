/**
 * Unified-diff parsing for the diff card, and a line diff for the edit
 * approval card (which only has the old and new text of one chunk).
 */

export type DiffLineKind = "context" | "add" | "del";

export interface DiffLine {
  kind: DiffLineKind;
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

/** Parses `git diff` output. Binary files and mode-only changes are skipped. */
export function parseUnifiedDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      file = {
        path: line.split(" b/").at(-1) ?? line,
        hunks: [],
        additions: 0,
        deletions: 0,
      };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    // "+++ b/path" belongs to the file header, before any hunk. Inside a hunk
    // the same characters are an added line that starts with "++ ".
    if (!hunk && line.startsWith("+++ ")) {
      const target = line.slice(4);
      if (target !== "/dev/null") file.path = target.replace(/^b\//, "");
      continue;
    }
    const header = HUNK_HEADER.exec(line);
    if (header) {
      oldNo = Number(header[1]);
      newNo = Number(header[2]);
      hunk = { header: (header[3] ?? "").trim(), lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith("+")) {
      hunk.lines.push({
        kind: "add",
        oldNo: null,
        newNo: newNo++,
        text: line.slice(1),
      });
      file.additions++;
    } else if (line.startsWith("-")) {
      hunk.lines.push({
        kind: "del",
        oldNo: oldNo++,
        newNo: null,
        text: line.slice(1),
      });
      file.deletions++;
    } else if (line.startsWith(" ")) {
      hunk.lines.push({
        kind: "context",
        oldNo: oldNo++,
        newNo: newNo++,
        text: line.slice(1),
      });
    }
  }
  return files.filter((f) => f.hunks.length > 0);
}

/**
 * Line diff of two texts as hunks with `context` lines around each change.
 * LCS over lines; the inputs are single edit chunks, so the quadratic table
 * stays small.
 */
export function diffLines(
  before: string,
  after: string,
  startLine = 1,
  context = 2,
): DiffHunk[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = lcs[i]!;
      row[j] =
        a[i] === b[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, row[j + 1]!);
    }
  }

  const all: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldNo = startLine;
  let newNo = startLine;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      all.push({
        kind: "context",
        oldNo: oldNo++,
        newNo: newNo++,
        text: a[i]!,
      });
      i++;
      j++;
    } else if (
      j < b.length &&
      (i >= a.length || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)
    ) {
      all.push({ kind: "add", oldNo: null, newNo: newNo++, text: b[j]! });
      j++;
    } else {
      all.push({ kind: "del", oldNo: oldNo++, newNo: null, text: a[i]! });
      i++;
    }
  }

  const keep = all.map((line, index) =>
    all
      .slice(Math.max(0, index - context), index + context + 1)
      .some((near) => near.kind !== "context"),
  );
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  all.forEach((line, index) => {
    if (!keep[index]) {
      current = null;
      return;
    }
    if (!current) {
      current = { header: "", lines: [] };
      hunks.push(current);
    }
    current.lines.push(line);
  });
  return hunks;
}

export function languageOf(path: string): string | null {
  const ext = path.split(".").at(-1)?.toLowerCase();
  switch (ext) {
    case "py":
      return "python";
    case "ts":
      return "typescript";
    case "tsx":
      return "tsx";
    case "js":
    case "mjs":
    case "cjs":
      return "javascript";
    case "json":
      return "json";
    case "yml":
    case "yaml":
      return "yaml";
    case "toml":
      return "toml";
    case "sh":
      return "bash";
    case "md":
      return "markdown";
    default:
      return null;
  }
}
