import type { Edit } from "codemod:ast-grep";
import { removeSpecifier, zodBinding } from "./ast-helpers.ts";
import type { Node } from "./ast-helpers.ts";
import { byteIndex, charIndex } from "./offsets.ts";

const V1_SOURCE = "@copilotkit/react-core";

/** What a call needs besides its own edits. */
export interface CallConversion {
  edits: Edit[];
  /** 2.0 names to import from the module the v1 name came from. */
  hooks: string[];
  /** Other imports the new code uses, by module. */
  imports?: Record<string, string[]>;
  /** Names of that module's import to drop once nothing uses them. */
  dropIfUnused?: string[];
}

export interface V1CallOptions {
  /** The module the v1 name is imported from. */
  source?: string;
  /** Parses changed source: needed to drop imports that end up unused. */
  reparse?: (text: string) => Node;
}

export interface CallContext {
  source: string;
  /** The local name of `z` from "zod" (imported when a call uses it). */
  z: string;
  /** Marks that a call uses `z`. */
  useZod: () => void;
}

/**
 * Rewrites the calls of one v1 hook from `@copilotkit/react-core`:
 * `convert` turns a call into 2.0 code, or returns `null` to leave it (the
 * import pass then marks it with a TODO). The import of the v1 hook is
 * replaced by the 2.0 names the calls use, and keeps the v1 name while a
 * call of it is left. `zod` and the other imports the new code needs are
 * added. A file that imports the hook under an alias, or as a type, is left
 * alone.
 *
 * Returns the new source, or `null` when nothing changed.
 */
export function migrateV1Calls(
  rootNode: Node,
  v1Name: string,
  convert: (call: Node, context: CallContext) => CallConversion | null,
  options: V1CallOptions = {},
): string | null {
  const v1Source = options.source ?? V1_SOURCE;
  const source = rootNode.text();
  if (!source.includes(v1Name)) return null;
  const specifiers = rootNode
    .findAll({ rule: { kind: "import_statement" } })
    .filter(
      (statement) =>
        statement.field("source")?.text().slice(1, -1) === v1Source,
    )
    .flatMap((statement) =>
      statement
        .findAll({ rule: { kind: "import_specifier" } })
        .filter((specifier) => specifier.field("name")?.text() === v1Name)
        .map((specifier) => ({ statement, specifier })),
    );
  const plain = specifiers.filter(
    ({ specifier }) =>
      !specifier.field("alias") && !/^type\s/.test(specifier.text()),
  );
  if (plain.length !== 1 || specifiers.length !== 1) return null;

  const zod = zodBinding(rootNode);
  let usesZod = false;
  const context: CallContext = {
    source,
    z: zod ?? "z",
    useZod: () => {
      usesZod = true;
    },
  };
  const edits: Edit[] = [];
  const hooks = new Set<string>();
  const imports = new Map<string, Set<string>>();
  const dropIfUnused = new Set<string>();
  let left = 0;
  const calls = rootNode.findAll({
    rule: {
      kind: "call_expression",
      has: { field: "function", kind: "identifier", regex: `^${v1Name}$` },
    },
  });
  for (const call of calls) {
    const converted = convert(call, context);
    if (!converted) {
      left++;
      continue;
    }
    edits.push(...converted.edits);
    for (const hook of converted.hooks) hooks.add(hook);
    for (const name of converted.dropIfUnused ?? []) dropIfUnused.add(name);
    for (const [from, names] of Object.entries(converted.imports ?? {})) {
      const set = imports.get(from) ?? new Set<string>();
      for (const name of names) set.add(name);
      imports.set(from, set);
    }
  }
  if (edits.length === 0) return null;

  const { statement, specifier } = plain[0]!;
  const imported = new Set(
    statement
      .findAll({ rule: { kind: "import_specifier" } })
      .map((other: Node) => other.field("name")?.text()),
  );
  const added = [...hooks].filter((hook) => !imported.has(hook));
  const names = left > 0 ? [v1Name, ...added] : added;
  edits.push(
    names.length === 0
      ? removeSpecifier(specifier, source)
      : specifier.replace(names.join(", ")),
  );
  // With no call of the v1 hook left, the TODOs an earlier run wrote about
  // it are stale.
  if (left === 0) edits.push(...staleTodoEdits(rootNode, source, v1Name));

  if (usesZod && zod === undefined) {
    imports.set("zod", (imports.get("zod") ?? new Set()).add("z"));
  }
  edits.push(...importEdits(rootNode, source, imports));
  const migrated = rootNode.commitEdits(edits);
  if (dropIfUnused.size === 0 || !options.reparse) return migrated;
  return (
    dropUnusedSpecifiers(options.reparse(migrated), v1Source, dropIfUnused) ??
    migrated
  );
}

/** Drops the named specifiers of `from`'s import that nothing else uses. */
function dropUnusedSpecifiers(
  rootNode: Node,
  from: string,
  names: Set<string>,
): string | null {
  const source = rootNode.text();
  const edits: Edit[] = [];
  for (const statement of rootNode.findAll({
    rule: { kind: "import_statement" },
  })) {
    if (statement.field("source")?.text().slice(1, -1) !== from) continue;
    for (const specifier of statement.findAll({
      rule: { kind: "import_specifier" },
    })) {
      const name = specifier.field("name")?.text();
      if (!name || !names.has(name) || specifier.field("alias")) continue;
      const uses = rootNode.findAll({
        rule: {
          any: [{ kind: "identifier" }, { kind: "type_identifier" }],
          regex: `^${name}$`,
        },
      }).length;
      // The specifier's own identifier is the one use.
      if (uses <= 1) edits.push(removeSpecifier(specifier, source));
    }
  }
  return edits.length === 0 ? null : rootNode.commitEdits(edits);
}

/** Deletes the `// TODO(copilotkit-2.0): \`name\`...` lines of the file. */
function staleTodoEdits(rootNode: Node, source: string, name: string): Edit[] {
  const prefix = `// TODO(copilotkit-2.0): \`${name}\``;
  return rootNode
    .findAll({ rule: { kind: "comment" } })
    .filter((comment) => comment.text().startsWith(prefix))
    .map((comment) => {
      const start = charIndex(source, comment.range().start.index);
      const end = charIndex(source, comment.range().end.index);
      const lineStart = source.lastIndexOf("\n", start - 1) + 1;
      const alone = source.slice(lineStart, start).trim() === "";
      const from = alone ? lineStart : start;
      const to = source[end] === "\n" && alone ? end + 1 : end;
      return {
        startPos: byteIndex(source, from),
        endPos: byteIndex(source, to),
        insertedText: "",
      };
    });
}

/**
 * Imports `names` from each module: into an existing named value import of
 * that module, or as a new import after the last import of the file.
 */
function importEdits(
  rootNode: Node,
  source: string,
  imports: Map<string, Set<string>>,
): Edit[] {
  const statements = rootNode.findAll({ rule: { kind: "import_statement" } });
  const edits: Edit[] = [];
  const lines: string[] = [];
  for (const [from, names] of imports) {
    const existing = statements.find(
      (statement) =>
        statement.field("source")?.text().slice(1, -1) === from &&
        !/^import\s+type\b/.test(statement.text()) &&
        statement.find({ rule: { kind: "named_imports" } }),
    );
    const bound = new Set(
      statements
        .filter(
          (statement) =>
            statement.field("source")?.text().slice(1, -1) === from,
        )
        .flatMap((statement) =>
          statement
            .findAll({ rule: { kind: "import_specifier" } })
            .map((specifier) => specifier.field("name")?.text()),
        ),
    );
    const missing = [...names].filter((name) => !bound.has(name));
    if (missing.length === 0) continue;
    const list = existing?.find({ rule: { kind: "named_imports" } });
    const last = list?.findAll({ rule: { kind: "import_specifier" } }).pop();
    if (last) {
      // Not the statement itself: a second edit of it would be dropped.
      const end = last.range().end.index;
      edits.push({
        startPos: end,
        endPos: end,
        insertedText: `, ${missing.join(", ")}`,
      });
    } else {
      lines.push(`import { ${missing.join(", ")} } from "${from}";`);
    }
  }
  if (lines.length === 0) return edits;
  const last = statements[statements.length - 1];
  if (!last) {
    edits.push({
      startPos: 0,
      endPos: 0,
      insertedText: `${lines.join("\n")}\n`,
    });
    return edits;
  }
  const end = last.range().end.index;
  edits.push(
    source[charIndex(source, end)] === "\n"
      ? {
          startPos: end + 1,
          endPos: end + 1,
          insertedText: `${lines.join("\n")}\n`,
        }
      : { startPos: end, endPos: end, insertedText: `\n${lines.join("\n")}` },
  );
  return edits;
}
