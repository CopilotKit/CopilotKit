/**
 * Terminal output made readable in a chat card.
 *
 * Shell commands write ANSI colour codes and redraw progress bars with
 * carriage returns. Printed as-is that becomes escape soup and hundreds of
 * half-drawn bars. This keeps what a terminal would finally show: escapes
 * removed, each carriage-return-redrawn line reduced to its last state.
 */

import stripAnsi from "strip-ansi";

const LOG_LINE = /^\s*Log:\s*file:\/\/\S*\s*$/;
const FILE_URI = /file:\/\/\S+/g;
const CONVERSATION_TASK = /\b[0-9a-f]{16,}\/(task-\d+)\b/g;

/** Drops control characters a terminal would not print, keeping tabs. */
function dropControlCharacters(line: string): string {
  let out = "";
  for (const ch of line) {
    const code = ch.charCodeAt(0);
    if ((code < 0x20 && code !== 0x09) || code === 0x7f) continue;
    out += ch;
  }
  return out;
}

/** The final state of a line a terminal redrew with carriage returns. */
function resolveCarriageReturns(line: string): string {
  if (!line.includes("\r")) return line;
  const parts = line.split("\r");
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i]!.trim()) return parts[i]!;
  }
  return "";
}

/** Readable lines of a command's combined output. */
export function cleanOutput(raw: string): string[] {
  const text = stripAnsi(raw.replace(/\r\n/g, "\n"));
  const lines = text
    .split("\n")
    .map((line) =>
      dropControlCharacters(resolveCarriageReturns(line)).trimEnd(),
    )
    .filter((line) => !LOG_LINE.test(line))
    .map((line) => line.replace(FILE_URI, "").replace(CONVERSATION_TASK, "$1"));
  // Drop leading and trailing blank lines; keep blank lines inside.
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start]!.trim()) start++;
  while (end > start && !lines[end - 1]!.trim()) end--;
  return lines.slice(start, end);
}

/** `task-26` (or `<conversation>/task-26`) as people read it. */
export function taskLabel(raw: unknown): string {
  const value = typeof raw === "string" ? raw : "";
  const match = /task-(\d+)/.exec(value);
  return match ? `task ${match[1]}` : value;
}
