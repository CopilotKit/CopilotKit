import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";

import type { HookName, ToolDescriptor } from "../shared/types.js";

/**
 * M0 scanner — naive walk + string prefilter + regex match.
 *
 * This is the **simplest correct version** of the scanner. It walks the
 * project tree, picks `*.ts` / `*.tsx` files that import from
 * `@copilotkit/react-core`, and extracts every `useCopilotAction(` call
 * site by regex.
 *
 * Real AST parsing with `oxc-parser` (and schema extraction) is the job of
 * M1; see .chalk/plans/web-inspector-v1.md §9 M1 and
 * .chalk/plans/web-inspector-execution.md Agent A/B/etc. Do not extend this
 * file with schema extraction — replace it wholesale when porting
 * vscode-extension/src/extension/hooks/hook-scanner.ts.
 *
 * Limits the scanner intentionally has in M0:
 *   - Only matches the literal hook name `useCopilotAction` (the only one
 *     in heavy use today). M1 will add the rest of {@link HookName}.
 *   - `name` is extracted from the first string-literal argument-bag key
 *     `name: "..."` on the same or following few lines. Anything dynamic
 *     becomes `"<unknown>"`.
 *   - `parameters` is always `[]`.
 *   - `enclosingComponent` is always `null`.
 *   - `fixtures` / `fixturePath` are always `null`.
 *   - `loc` only fills `line`; the other three fields are placeholders.
 */

/** Directories the scanner refuses to descend into. */
const SKIP_DIRS = new Set<string>([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".nx",
  "out",
  "coverage",
  ".angular",
  "storybook-static",
  ".venv",
  "__pycache__",
]);

const SOURCE_EXTENSIONS = [".ts", ".tsx"] as const;

/** Cheap prefilter — files without this import marker are skipped. */
const COPILOTKIT_IMPORT_MARKER = "@copilotkit/react-core";

/** Hooks we look for in M0. M1 will broaden this. */
const HOOK_PATTERNS: ReadonlyArray<{ hook: HookName; regex: RegExp }> = [
  { hook: "useCopilotAction", regex: /\buseCopilotAction\s*\(/g },
];

/**
 * Extracts the first `name: "..."` string-literal value within a small
 * window after the hook call. Returns `<unknown>` if the name can't be
 * resolved statically — that's a known M0 limitation, replaced by AST-based
 * extraction in M1.
 */
function extractToolName(content: string, hookCallIndex: number): string {
  // Look at the next ~1500 chars after the hook call — plenty of headroom
  // for prop-bag style and short multi-line objects without scanning the
  // entire rest of the file.
  const window = content.slice(hookCallIndex, hookCallIndex + 1500);
  const match = window.match(/\bname\s*:\s*["'`]([^"'`]+)["'`]/);
  return match?.[1] ?? "<unknown>";
}

function lineNumberAt(content: string, index: number): number {
  // 1-indexed line number — matches editor convention and oxc-parser output.
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

/** Recursively walk a directory, yielding absolute paths to source files. */
async function* walkSourceFiles(rootDir: string): AsyncGenerator<string> {
  const stack: string[] = [rootDir];

  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      // Permission errors, broken symlinks, etc. — silently skip.
      continue;
    }

    for (const entry of entries) {
      if (
        entry.name.startsWith(".") &&
        entry.name !== "." &&
        entry.name !== ".."
      ) {
        // Skip dotfiles/dotdirs except explicit allowlist (none in M0).
        continue;
      }
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        stack.push(fullPath);
      } else if (entry.isFile()) {
        if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
          yield fullPath;
        }
      }
    }
  }
}

/**
 * Pull every recognized hook call out of a single file's contents. Returns
 * an empty array when the file doesn't import from `@copilotkit/react-core`
 * (the cheap prefilter — same pattern as
 * vscode-extension/src/extension/hooks/hook-scanner.ts).
 */
export function scanContent(
  filePath: string,
  content: string,
): ToolDescriptor[] {
  if (!content.includes(COPILOTKIT_IMPORT_MARKER)) return [];

  const descriptors: ToolDescriptor[] = [];

  for (const { hook, regex } of HOOK_PATTERNS) {
    // Reset regex state — pattern is module-level so it carries lastIndex
    // across invocations otherwise.
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const name = extractToolName(content, match.index);
      const line = lineNumberAt(content, match.index);

      descriptors.push({
        name,
        hook,
        filePath,
        loc: {
          line,
          column: 0,
          endLine: line,
          endColumn: 0,
        },
        enclosingComponent: null,
        parameters: [],
        fixtures: null,
        fixturePath: null,
      });
    }
  }

  return descriptors;
}

/**
 * Scan a project root, returning every detected tool plus the count of
 * files inspected (after the prefilter).
 */
export async function scanWorkspace(rootDir: string): Promise<{
  tools: ToolDescriptor[];
  scannedFiles: number;
}> {
  const absoluteRoot = resolve(rootDir);
  const tools: ToolDescriptor[] = [];
  let scannedFiles = 0;

  for await (const filePath of walkSourceFiles(absoluteRoot)) {
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }
    scannedFiles++;
    const found = scanContent(filePath, content);
    if (found.length > 0) tools.push(...found);
  }

  return { tools, scannedFiles };
}
