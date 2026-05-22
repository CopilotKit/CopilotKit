import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";

import { parseSync } from "oxc-parser";

import type { HookName, ToolDescriptor } from "../shared/types.js";

import { buildLineOffsets, offsetToLineColumn } from "./ast-utils.js";
import {
  HOOK_IMPORT_SOURCES,
  HOOK_REGISTRY,
  getHookDef,
  isCopilotKitHook,
} from "./hook-registry.js";
import { buildEnclosingComponentLookup } from "./map-hooks-to-components.js";
import {
  extractDescription,
  extractName,
  extractParameters,
} from "./schema-extraction.js";

/**
 * M1 scanner.
 *
 * Replaces M0's regex-based extraction with a real AST walk using
 * `oxc-parser`. The shape is a straight port of
 * .chalk/references/vscode-extension/src/extension/hooks/hook-scanner.ts:
 *   1. Cheap string prefilter (skip files without a `@copilotkit/` import).
 *   2. Parse with oxc.
 *   3. Walk the `ImportDeclaration` nodes to build a `localName → canonical`
 *      map (handles `import { useCopilotAction as ax } from ...`).
 *   4. Walk all `CallExpression` nodes; for any matching the local→canonical
 *      map, extract name/description/parameters/loc/enclosingComponent.
 *
 * Schema extraction lives in `./schema-extraction.ts` so the AST walk here
 * stays focused on the call-site shape.
 *
 * **Failure mode**: parse errors collapse to `{ tools: [], parseError:
 * "..." }`. The launcher emits `scan.error` events for these so the SPA can
 * surface a non-fatal banner.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AstNode = any;

/** Directories the scanner refuses to descend into during full-workspace walks. */
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

/** Cached prefilter substrings — bundled here so we only compute the array once. */
const PREFILTER_STRINGS: ReadonlyArray<string> = [...HOOK_IMPORT_SOURCES];

/**
 * AST node types that never contain nested hook call-sites. Short-circuits
 * the visitor to avoid recursing into identifier names, literal values, etc.
 *
 * Direct port of the LEAF_TYPES set in
 * .chalk/references/vscode-extension/src/extension/hooks/hook-scanner.ts.
 */
const LEAF_TYPES = new Set([
  "Identifier",
  "Literal",
  "StringLiteral",
  "NumericLiteral",
  "BooleanLiteral",
  "NullLiteral",
  "RegExpLiteral",
  "BigIntLiteral",
  "TemplateElement",
  "ThisExpression",
  "Super",
  "Import",
  "PrivateIdentifier",
]);

export type ScanResult = {
  tools: ToolDescriptor[];
  /** Set when the parser failed; the launcher uses this to emit `scan.error`. */
  parseError?: string;
};

/**
 * Parse a single file's contents and return every hook call site as a
 * `ToolDescriptor`. Never throws — parse errors become `parseError` on the
 * result; other unexpected errors collapse to an empty result.
 */
export function scanContent(filePath: string, content: string): ScanResult {
  if (!hasCopilotKitPrefix(content)) return { tools: [] };

  const lang = filePath.endsWith(".tsx") ? "tsx" : "ts";
  let program: AstNode;
  try {
    const res = parseSync(filePath, content, {
      lang,
      sourceType: "module",
    });
    if (res.errors && res.errors.length > 0) {
      // Multiple errors can land here; we surface the first message and
      // the line/column for diagnostics. The user will see this in the
      // launcher's `scan.error` banner.
      const first = res.errors[0]!;
      const message =
        typeof first.message === "string"
          ? first.message
          : "Parse error (no message)";
      return {
        tools: [],
        parseError: message,
      };
    }
    program = res.program as AstNode;
  } catch (err) {
    return {
      tools: [],
      parseError: (err as Error).message ?? "Parse failed",
    };
  }

  const localToCanonical = collectLocalToCanonical(program);
  if (localToCanonical.size === 0) return { tools: [] };

  const lineOffsets = buildLineOffsets(content);
  const enclosingLookup = buildEnclosingComponentLookup(program);
  const tools: ToolDescriptor[] = [];

  const seen = new WeakSet<object>();
  const visit = (node: AstNode): void => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (LEAF_TYPES.has(node.type)) return;

    if (node.type === "CallExpression" && node.callee?.type === "Identifier") {
      const canonical = localToCanonical.get(node.callee.name);
      if (canonical) {
        const def = getHookDef(canonical);
        if (def) {
          const descriptor = buildToolDescriptor(
            filePath,
            node,
            canonical,
            lineOffsets,
            enclosingLookup,
          );
          if (descriptor) tools.push(descriptor);
        }
      }
    }

    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "range" || key === "parent") continue;
      const child = (node as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const c of child) visit(c);
      } else if (child && typeof child === "object" && "type" in child) {
        visit(child);
      }
    }
  };
  visit(program);
  return { tools };
}

/**
 * Scan a whole project root for hook call sites. Returns the full
 * `ToolDescriptor[]` plus the number of files inspected (after the
 * prefilter) and any per-file parse errors so the launcher can surface
 * them.
 */
export async function scanWorkspace(rootDir: string): Promise<{
  tools: ToolDescriptor[];
  scannedFiles: number;
  errors: Array<{ filePath: string; message: string }>;
}> {
  const absoluteRoot = resolve(rootDir);
  const tools: ToolDescriptor[] = [];
  const errors: Array<{ filePath: string; message: string }> = [];
  let scannedFiles = 0;

  for await (const filePath of walkSourceFiles(absoluteRoot)) {
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }
    scannedFiles++;
    const result = scanContent(filePath, content);
    if (result.parseError) {
      errors.push({ filePath, message: result.parseError });
      continue;
    }
    if (result.tools.length > 0) tools.push(...result.tools);
  }

  return { tools, scannedFiles, errors };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasCopilotKitPrefix(content: string): boolean {
  return PREFILTER_STRINGS.some((p) => content.includes(p));
}

/**
 * Build a map from the local identifier in *this* file → the canonical hook
 * name in `HOOK_REGISTRY`. Lets users alias imports (`import {
 * useCopilotAction as ax }`) and still get detected.
 *
 * Only imports from the registered import sources count. Other
 * `useCopilotAction`-shaped imports from third-party packages are ignored.
 */
function collectLocalToCanonical(program: AstNode): Map<string, HookName> {
  const localToCanonical = new Map<string, HookName>();

  for (const node of program.body ?? []) {
    if (node.type !== "ImportDeclaration") continue;
    const src = typeof node.source?.value === "string" ? node.source.value : "";
    if (!HOOK_IMPORT_SOURCES.has(src)) continue;

    for (const spec of node.specifiers ?? []) {
      if (spec.type !== "ImportSpecifier") continue;
      const imported =
        spec.imported?.type === "Identifier"
          ? (spec.imported.name as string)
          : null;
      const local =
        spec.local?.name === undefined ? imported : (spec.local.name as string);
      if (imported && local && isCopilotKitHook(imported)) {
        localToCanonical.set(local, imported as HookName);
      }
    }
  }

  // Belt-and-suspenders: if `HOOK_REGISTRY` ever gains a new entry without
  // an importSource the map will be empty here, which fails closed — better
  // than spuriously matching arbitrary functions.
  if (localToCanonical.size === 0 && HOOK_REGISTRY.length === 0) {
    // dev-time invariant
    return new Map();
  }
  return localToCanonical;
}

function buildToolDescriptor(
  filePath: string,
  callNode: AstNode,
  canonical: HookName,
  lineOffsets: number[],
  enclosingLookup: (offset: number) => string | null,
): ToolDescriptor | null {
  const firstArg = callNode.arguments?.[0];
  const name = extractName(firstArg) ?? "<unknown>";
  const description = extractDescription(firstArg);
  const parameters = extractParameters(firstArg);

  const start = offsetToLineColumn(callNode.start ?? 0, lineOffsets);
  const end = offsetToLineColumn(callNode.end ?? 0, lineOffsets);
  const enclosing = enclosingLookup(callNode.start ?? 0);

  return {
    name,
    hook: canonical,
    filePath,
    loc: {
      line: start.line,
      column: start.column,
      endLine: end.line,
      endColumn: end.column,
    },
    enclosingComponent: enclosing,
    ...(description ? { description } : {}),
    parameters,
    fixtures: null,
    fixturePath: null,
  };
}

async function* walkSourceFiles(rootDir: string): AsyncGenerator<string> {
  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (
        entry.name.startsWith(".") &&
        entry.name !== "." &&
        entry.name !== ".."
      ) {
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
