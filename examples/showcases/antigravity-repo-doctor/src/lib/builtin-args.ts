/**
 * Arguments of Antigravity's built-in tools, in one place.
 *
 * They arrive in two shapes. Over AG-UI (tool cards) the harness reports them
 * normalized and snake_case: `file_path`, `query`, 0-based `start_line`. On an
 * approval interrupt they are what the model sent: `TargetFile`, `CommandLine`,
 * 1-based `StartLine`. Each accessor reads whichever is present.
 */

type Args = Record<string, unknown>;

function first(args: Args, ...keys: string[]): unknown {
  for (const key of keys) if (args[key] !== undefined) return args[key];
  return undefined;
}

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

export const builtinArgs = {
  filePath: (a: Args) =>
    str(first(a, "file_path", "AbsolutePath", "TargetFile")),
  directory: (a: Args) =>
    str(
      first(
        a,
        "directory_path",
        "search_directory",
        "SearchPath",
        "SearchDirectory",
        "DirectoryPath",
      ),
    ),
  query: (a: Args) => str(first(a, "query", "Query")),
  /** find_file reports its folder as `file_path` and its glob as `query`. */
  findFile: (a: Args) => ({
    directory: str(
      first(
        a,
        "file_path",
        "directory_path",
        "search_directory",
        "SearchDirectory",
      ),
    ),
    pattern: str(first(a, "query", "Pattern")),
  }),
  commandLine: (a: Args) =>
    str(first(a, "command_line", "command", "CommandLine")),
  cwd: (a: Args) => str(first(a, "cwd", "Cwd")),
  description: (a: Args) => str(first(a, "description", "Description")),
  /** The edit as old and new text, for the approval card's preview. */
  edit: (a: Args) => ({
    before: str(first(a, "TargetContent", "target_content")),
    after: str(first(a, "ReplacementContent", "replacement_content")),
    startLine: typeof a.StartLine === "number" ? a.StartLine : 1,
  }),
  /** A 1-based "lines a-b" label; the AG-UI shape counts from 0. */
  lineRange: (a: Args): string | undefined => {
    if (typeof a.start_line === "number" && typeof a.end_line === "number") {
      return `lines ${a.start_line + 1}-${a.end_line + 1}`;
    }
    if (typeof a.StartLine === "number" && typeof a.EndLine === "number") {
      return `lines ${a.StartLine}-${a.EndLine}`;
    }
    return undefined;
  },
};
