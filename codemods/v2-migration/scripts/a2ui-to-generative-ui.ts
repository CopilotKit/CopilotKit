import type { Edit, SgNode } from "codemod:ast-grep";
import type TSX from "codemod:ast-grep/langs/tsx";
import {
  applyEdits,
  argumentNodes,
  indentOf,
  keyOf,
  propertyKey,
  removeEntry,
  removeSpecifier,
  type Node,
} from "./ast-helpers.ts";
import { byteIndex, charIndex } from "./offsets.ts";

/**
 * Moves the client off A2UI v0.9 (the `a2ui` provider option and
 * `@copilotkit/a2ui-renderer`) to generative UI (A2UI 1.0), and moves the
 * runtime `a2ui` option under `generativeUI`. See `migrateA2UI`.
 */

const TODO = "TODO(copilotkit-2.0):";
const GUIDE = "https://docs.copilotkit.ai/generative-ui/components/from-a2ui";

export const RENDERER_NOTE = `This was a v0.9 renderer, which got \`{ props, children, dispatch }\`. A 2.0 component gets its resolved props directly, child components as slots or \`child()\` / \`childList()\` props, and calls an event or a function instead of \`dispatch\`. Rewrite it. See ${GUIDE}#convert-a-custom-catalog`;
export const ANGULAR_COMPONENT_NOTE = `This was a v0.9 Angular component. In 2.0 it gets each prop as an input with its resolved value, child components as \`GenerativeUIChildren\` inputs, and an event input or a \`registerGenerativeUIFunction\` function replaces \`dispatch\` from \`injectA2UIComponentContext()\`. Update the component. See ${GUIDE}#convert-a-custom-catalog`;
export const DESCRIPTION_NOTE = `Add a \`description\` to this component. The agent reads it to choose the component. See ${GUIDE}#convert-a-custom-catalog`;
export const CATALOG_NOTE = `This v0.9 catalog could not be converted automatically. Rewrite it with \`createGenerativeUI({ id, extends: [standardUI], components })\`, one entry per component with \`component\`, \`description\` and plain \`props\`. See ${GUIDE}#convert-a-custom-catalog`;
export const SCHEMA_NOTE = `This v0.9 binding or action schema has no 2.0 equivalent. A bound prop takes its plain type (the engine resolves \`{ "@path" }\` before the component renders), and an action becomes an event that the component calls. See ${GUIDE}#bindings-and-actions`;
export const PROVIDER_NOTE = `The \`a2ui\` option was removed in 2.0. Pass \`generativeUI={{ ui }}\` with a UI from \`createGenerativeUI\`, or delete it to use the standard catalog. See ${GUIDE}#before-and-after`;
export const PROVIDER_OPTIONS_NOTE = `The \`a2ui\` option was removed in 2.0, and these options have no 1:1 equivalent: \`theme\` becomes the \`theme\` of the generative UI config (CSS variables), \`onAction\` becomes events or functions on the components, and \`loadingComponent\`, \`recovery\` and \`includeSchema\` are gone. Move what you need, then delete \`a2ui\`. See ${GUIDE}`;
export const ANGULAR_PROVIDER_NOTE = `The \`a2ui\` option was removed in 2.0. Add \`provideGenerativeUI({ ui })\` from "@copilotkit/angular/generative-ui" next to \`provideCopilotKit\`, with a UI from \`createGenerativeUI\`, and delete \`a2ui\`. See ${GUIDE}#before-and-after`;
export const PACKAGE_NOTE = `The A2UI v0.9 client (\`@copilotkit/a2ui-renderer\`, \`@copilotkit/angular/a2ui\`) was removed in 2.0. Use generative UI from the framework's \`/generative-ui\` entry: \`createGenerativeUI\` and \`standardUI\` for catalogs, \`GenerativeUISurface\` for a surface, and \`useGenerativeUIState\` and \`useGenerativeUIFunction\` for state and actions. Then delete this import. See ${GUIDE}`;
export const RUNTIME_NOTE = `The runtime \`a2ui\` option moved to \`generativeUI: { a2uiVersion: "0.9", ...options }\` in 2.0. The codemod could not move this one: its value is not an object literal, its \`enabled\` is not \`true\` or \`false\`, or \`generativeUI\` already sets one of its keys. Move it by hand, or delete it if it was off. See ${GUIDE}#before-and-after`;

const A2UI_RENDERER = "@copilotkit/a2ui-renderer";
const ANGULAR_A2UI = "@copilotkit/angular/a2ui";
/** The packages of the v0.9 client. Their unused imports are deleted. */
const A2UI_SOURCES = new Set([A2UI_RENDERER, ANGULAR_A2UI]);

type Framework = "react" | "angular";
const GENERATIVE_UI_SOURCE: Record<Framework, string> = {
  react: "@copilotkit/react-core/generative-ui",
  angular: "@copilotkit/angular/generative-ui",
};
const FRAMEWORK_OF: Record<string, Framework> = {
  [A2UI_RENDERER]: "react",
  [ANGULAR_A2UI]: "angular",
};

/** The v0.9 catalog factories, and the catalog id each used when none was given. */
const CATALOG_FACTORIES = [
  {
    source: A2UI_RENDERER,
    name: "createCatalog",
    framework: "react",
    defaultId: "copilotkit://custom-catalog",
  },
  {
    source: ANGULAR_A2UI,
    name: "createAngularCatalog",
    framework: "angular",
    defaultId: "copilotkit://angular-catalog",
  },
] as const;

/** v0.9 prop schemas and the plain zod schema, by `z`, that replaces them. */
const DYNAMIC_SCHEMAS: Record<string, (z: string) => string> = {
  DynamicStringSchema: (z) => `${z}.string()`,
  DynamicNumberSchema: (z) => `${z}.number()`,
  DynamicBooleanSchema: (z) => `${z}.boolean()`,
  DynamicStringListSchema: (z) => `${z}.array(${z}.string())`,
};
/** v0.9 prop types and the plain type that replaces them. */
const DYNAMIC_TYPES: Record<string, string> = {
  DynamicString: "string",
  DynamicNumber: "number",
  DynamicBoolean: "boolean",
  DynamicStringList: "string[]",
};
/** v0.9 schemas the codemod cannot replace. */
const UNMAPPED_SCHEMAS = new Set(["DataBindingSchema", "ActionSchema"]);

/** The client providers that took `a2ui`, by package. */
const PROVIDER_SOURCES = [
  "@copilotkit/react-core",
  "@copilotkit/react-core/v2",
  "@copilotkit/vue",
  "@copilotkit/vue/v2",
];
const PROVIDER_NAMES = ["CopilotKitProvider", "CopilotKit"];
/** The basic v0.9 catalogs: the 2.0 client uses the standard catalog without one. */
const BASIC_CATALOGS: [string[], string][] = [
  [[A2UI_RENDERER], "basicCatalog"],
  [[ANGULAR_A2UI], "basicCatalog"],
  [["@copilotkit/vue", "@copilotkit/vue/v2"], "vueBasicCatalog"],
];
const RUNTIME_SOURCES = ["@copilotkit/runtime", "@copilotkit/runtime/v2"];
const RUNTIME_CLASSES = [
  "CopilotRuntime",
  "CopilotSseRuntime",
  "CopilotIntelligenceRuntime",
];
const ZOD_SOURCES = new Set(["zod", "zod/v4", "zod-v3"]);

/**
 * Migrates A2UI v0.9 to generative UI (A2UI 1.0):
 *
 * - `createCatalog(definitions, renderers, options)` from
 *   `@copilotkit/a2ui-renderer`, and `createAngularCatalog` from
 *   `@copilotkit/angular/a2ui`, become `createGenerativeUI({ id, extends,
 *   components })`, one component per name, with a TODO at each renderer
 *   and at each component without a `description`;
 * - the `Dynamic*Schema` props become plain zod types, a union with a
 *   `{ path }` binding object becomes its plain type, and `zod-v3` becomes
 *   `zod`, in files that import the v0.9 client;
 * - the `a2ui` provider prop becomes `generativeUI={{ ui }}`, or is deleted
 *   when it has no catalog; Angular gets `provideGenerativeUI({ ui })`;
 * - the runtime `a2ui` option moves to `generativeUI: { a2uiVersion: "0.9" }`.
 *
 * `reparse` parses the source after each step. Returns `null` when the file
 * does not change.
 */
export function migrateA2UI(
  rootNode: Node,
  reparse: (text: string) => Node,
): string | null {
  if (!/a2ui/i.test(rootNode.text())) return null;
  const state: State = { imports: new Map(), changed: false };
  let current = rootNode;
  for (const step of [catalogEdits, schemaEdits, unionEdits, configEdits]) {
    const edits = step(current, state);
    if (edits.length === 0) continue;
    state.changed = true;
    current = reparse(current.commitEdits(edits));
  }
  if (state.changed) {
    const edits = importEdits(current, state);
    if (edits.length > 0) current = reparse(current.commitEdits(edits));
  }
  const todos = packageEdits(current);
  if (todos.length > 0) return current.commitEdits(todos);
  return state.changed ? current.text() : null;
}

/** A TODO above each import or re-export of the removed v0.9 client that is left. */
function packageEdits(rootNode: Node): Edit[] {
  const source = rootNode.text();
  const edits: Edit[] = [];
  const statements = rootNode.findAll({
    rule: {
      any: [
        { kind: "import_statement" },
        { kind: "export_statement", has: { field: "source", kind: "string" } },
      ],
    },
  });
  for (const statement of statements) {
    const from = statement.field("source")?.text().slice(1, -1);
    if (from === undefined || !A2UI_SOURCES.has(from)) continue;
    const todo = todoAbove(statement, source, PACKAGE_NOTE);
    if (todo) edits.push(todo);
  }
  return edits;
}

interface State {
  /** Imports to add: names by source. */
  imports: Map<string, Set<string>>;
  changed: boolean;
}

function need(state: State, source: string, name: string) {
  const names = state.imports.get(source) ?? new Set<string>();
  names.add(name);
  state.imports.set(source, names);
}

// ---- Imports ----

interface ImportedName {
  local: string;
  name: string;
  source: string;
  specifier: Node;
  statement: Node;
}

function importsOf(rootNode: Node): ImportedName[] {
  const result: ImportedName[] = [];
  for (const statement of rootNode.findAll({
    rule: { kind: "import_statement" },
  })) {
    const source = statement.field("source")?.text().slice(1, -1);
    if (source === undefined) continue;
    for (const specifier of statement.findAll({
      rule: { kind: "import_specifier" },
    })) {
      const name = specifier.field("name")?.text();
      if (name === undefined) continue;
      const local = specifier.field("alias")?.text() ?? name;
      result.push({ local, name, source, specifier, statement });
    }
  }
  return result;
}

/** Local names imported from one of `sources`, by their exported name. */
function localsOf(
  rootNode: Node,
  sources: readonly string[],
  names: readonly string[],
): Map<string, string> {
  const locals = new Map<string, string>();
  for (const imported of importsOf(rootNode)) {
    if (sources.includes(imported.source) && names.includes(imported.name))
      locals.set(imported.local, imported.name);
  }
  return locals;
}

/** The name `zod` is bound to, if the file imports it. */
function zodName(rootNode: Node): string | undefined {
  for (const statement of rootNode.findAll({
    rule: { kind: "import_statement" },
  })) {
    const source = statement.field("source")?.text().slice(1, -1);
    if (source === undefined || !ZOD_SOURCES.has(source)) continue;
    if (/^import\s+type\b/.test(statement.text())) continue;
    const namespace = statement.find({ rule: { kind: "namespace_import" } });
    if (namespace)
      return namespace.find({ rule: { kind: "identifier" } })?.text();
    const clause = statement.find({ rule: { kind: "import_clause" } });
    const fallback = clause
      ?.children()
      .find((child) => child.kind() === "identifier");
    if (fallback) return fallback.text();
    for (const specifier of statement.findAll({
      rule: { kind: "import_specifier" },
    })) {
      if (specifier.field("name")?.text() === "z")
        return (specifier.field("alias") ?? specifier.field("name"))?.text();
    }
  }
  return undefined;
}

/** References to `name` outside import statements. */
function references(rootNode: Node, name: string): Node[] {
  return rootNode.findAll({
    rule: {
      any: [
        { kind: "identifier" },
        { kind: "type_identifier" },
        { kind: "shorthand_property_identifier" },
      ],
      regex: `^${name.replace(/\$/g, "\\$")}$`,
      not: { inside: { kind: "import_statement", stopBy: "end" } },
    },
  });
}

/**
 * Adds the imports the other steps need, and deletes the imports of the
 * v0.9 client that nothing uses any more.
 */
function importEdits(rootNode: Node, state: State): Edit[] {
  const source = rootNode.text();
  const edits: Edit[] = [];
  const imported = importsOf(rootNode);
  const statements = rootNode.findAll({ rule: { kind: "import_statement" } });

  /** Start offsets of the specifiers to delete. */
  const removed = new Set<number>();
  const at = (node: Node) => node.range().start.index;
  const removable = (entry: ImportedName) =>
    A2UI_SOURCES.has(entry.source) ||
    (entry.name === "vueBasicCatalog" &&
      entry.source.startsWith("@copilotkit/vue"));
  for (const entry of imported) {
    if (!removable(entry)) continue;
    if (references(rootNode, entry.local).length > 0) continue;
    removed.add(at(entry.specifier));
  }
  /** Import statements that lose every specifier. */
  const deleted: Node[] = [];
  for (const statement of statements) {
    const specifiers = statement.findAll({
      rule: { kind: "import_specifier" },
    });
    const gone = specifiers.filter((specifier) => removed.has(at(specifier)));
    if (gone.length === 0) continue;
    const clause = statement.find({ rule: { kind: "import_clause" } });
    const onlyNamed = clause
      ?.children()
      .every((child) => child.kind() === "named_imports");
    if (onlyNamed && gone.length === specifiers.length) {
      deleted.push(statement);
    } else {
      for (const specifier of gone)
        edits.push(dropSpecifier(specifier, source));
    }
  }

  const added: string[] = [];
  for (const [from, names] of state.imports) {
    const missing = [...names].filter(
      (name) =>
        !imported.some(
          (entry) =>
            entry.source === from &&
            entry.name === name &&
            !removed.has(at(entry.specifier)),
        ),
    );
    if (missing.length === 0) continue;
    const target = statements.find((statement) => {
      if (statement.field("source")?.text().slice(1, -1) !== from) return false;
      if (/^import\s+type\b/.test(statement.text())) return false;
      const clause = statement.find({ rule: { kind: "import_clause" } });
      return (
        clause?.children().every((child) => child.kind() === "named_imports") ??
        false
      );
    });
    const list = target?.find({ rule: { kind: "named_imports" } });
    const last = list
      ?.findAll({ rule: { kind: "import_specifier" } })
      .filter((specifier) => !removed.has(at(specifier)))
      .at(-1);
    if (target && last) {
      const multiline = list!.text().includes("\n");
      const indent = indentOf(last, source);
      const text = missing
        .map((name) => (multiline ? `,\n${indent}${name}` : `, ${name}`))
        .join("");
      const end = last.range().end.index;
      edits.push({ startPos: end, endPos: end, insertedText: text });
      continue;
    }
    added.push(`import { ${missing.join(", ")} } from "${from}";`);
  }
  const lastImport = statements.at(-1);
  // The new imports take the place of the last deleted import, or go after
  // the last import, so they never touch the edit of a deleted one.
  const replaced =
    added.length > 0 &&
    lastImport !== undefined &&
    deleted.some((statement) => at(statement) === at(lastImport))
      ? lastImport
      : undefined;
  for (const statement of deleted) {
    if (statement === replaced) continue;
    edits.push(deleteLines(statement, source));
  }
  if (added.length === 0) return edits;
  if (replaced) {
    edits.push(replaced.replace(added.join("\n")));
    return edits;
  }
  if (lastImport) {
    const end = lastImport.range().end.index;
    edits.push({
      startPos: end,
      endPos: end,
      insertedText: `\n${added.join("\n")}`,
    });
    return edits;
  }
  // No import yet: after the directives ("use client"), else at the top.
  const first = rootNode
    .children()
    .find(
      (child) =>
        child.kind() !== "comment" &&
        !(
          child.kind() === "expression_statement" &&
          child.child(0)?.kind() === "string"
        ),
    );
  const directive = rootNode
    .children()
    .filter(
      (child) =>
        child.kind() === "expression_statement" &&
        child.child(0)?.kind() === "string",
    )
    .at(-1);
  if (directive) {
    const end = directive.range().end.index;
    edits.push({
      startPos: end,
      endPos: end,
      insertedText: `\n${added.join("\n")}`,
    });
  } else {
    const start = first?.range().start.index ?? 0;
    edits.push({
      startPos: start,
      endPos: start,
      insertedText: `${added.join("\n")}\n\n`,
    });
  }
  return edits;
}

// ---- Text helpers ----

/**
 * Deletes an import specifier. Unlike `removeSpecifier`, the last specifier
 * on a line takes the comma before it: `{ a, b }` without `b` is `{ a }`.
 */
function dropSpecifier(specifier: Node, source: string): Edit {
  const startChar = charIndex(source, specifier.range().start.index);
  const endChar = charIndex(source, specifier.range().end.index);
  const lineStart = source.lastIndexOf("\n", startChar - 1) + 1;
  const inline = source.slice(lineStart, startChar).trim() !== "";
  const hasCommaAfter = /^\s*,/.test(source.slice(endChar));
  const before = /,\s*$/.exec(source.slice(0, startChar));
  if (inline && !hasCommaAfter && before) {
    return {
      startPos: byteIndex(source, startChar - before[0].length),
      endPos: specifier.range().end.index,
      insertedText: "",
    };
  }
  if (inline && hasCommaAfter) {
    const after = /^\s*,[ \t]*/.exec(source.slice(endChar))!;
    return {
      startPos: specifier.range().start.index,
      endPos: byteIndex(source, endChar + after[0].length),
      insertedText: "",
    };
  }
  return removeSpecifier(specifier, source);
}

/** Deletes `node` with its indentation and the line break after it. */
function deleteLines(node: Node, source: string): Edit {
  let start = charIndex(source, node.range().start.index);
  let end = charIndex(source, node.range().end.index);
  while (start > 0 && /[ \t]/.test(source[start - 1]!)) start--;
  if (source[end] === "\n") end++;
  // Do not leave two blank lines where the node was.
  if (
    source[end] === "\n" &&
    (start === 0 || source.slice(0, start).endsWith("\n\n"))
  )
    end++;
  return {
    startPos: byteIndex(source, start),
    endPos: byteIndex(source, end),
    insertedText: "",
  };
}

/** Deletes a JSX attribute with the whitespace before it. */
function deleteAttribute(attribute: Node, source: string): Edit {
  const startChar = charIndex(source, attribute.range().start.index);
  const endChar = charIndex(source, attribute.range().end.index);
  const lineStart = source.lastIndexOf("\n", startChar - 1) + 1;
  const ownLine =
    source.slice(lineStart, startChar).trim() === "" &&
    /^[ \t]*\n/.test(source.slice(endChar));
  if (ownLine) return deleteLines(attribute, source);
  let start = startChar;
  while (start > 0 && /\s/.test(source[start - 1]!)) start--;
  return {
    startPos: byteIndex(source, start),
    endPos: attribute.range().end.index,
    insertedText: "",
  };
}

/** `text` with each line after the first moved from `from` to `to`. */
function reindent(text: string, from: string, to: string) {
  if (from === to) return text;
  return text
    .split("\n")
    .map((line, index) =>
      index > 0 && line.startsWith(from) ? to + line.slice(from.length) : line,
    )
    .join("\n");
}

/** Whether the lines right above `node` are comments that include `line`. */
function hasCommentAbove(node: Node, source: string, line: string) {
  const start = charIndex(source, node.range().start.index);
  const lines = source.slice(0, start).split("\n");
  lines.pop();
  for (let i = lines.length - 1; i >= 0; i--) {
    const text = lines[i]!.trim();
    if (!text.startsWith("//") && !text.startsWith("/*")) return false;
    if (text === line) return true;
  }
  return false;
}

/**
 * A `// TODO` line above `node`. A node with code before it on its line
 * gets a `/* TODO *\/` comment right before it instead.
 */
function todoAbove(node: Node, source: string, note: string): Edit | null {
  const startChar = charIndex(source, node.range().start.index);
  const lineStart = source.lastIndexOf("\n", startChar - 1) + 1;
  if (source.slice(lineStart, startChar).trim() !== "")
    return todoBefore(node, source, note);
  const line = `// ${TODO} ${note}`;
  if (hasCommentAbove(node, source, line)) return null;
  const start = node.range().start.index;
  return {
    startPos: start,
    endPos: start,
    insertedText: `${line}\n${indentOf(node, source)}`,
  };
}

/** A `/* TODO *\/` comment right before `node`, on the same line. */
function todoBefore(node: Node, source: string, note: string): Edit | null {
  const comment = `/* ${TODO} ${note} */`;
  const start = node.range().start.index;
  if (source.slice(0, charIndex(source, start)).trimEnd().endsWith(comment))
    return null;
  return { startPos: start, endPos: start, insertedText: `${comment} ` };
}

/** The statement `node` is in: the ancestor whose parent holds statements. */
function enclosingStatement(node: Node) {
  let current: Node = node;
  for (;;) {
    const parent = current.parent();
    if (
      parent === null ||
      ["program", "statement_block", "class_body", "switch_case"].includes(
        parent.kind(),
      )
    )
      return current;
    current = parent;
  }
}

/** The entries of an object literal, or `null` when one has no static key. */
function entriesOf(object: Node): Node[] | null {
  const entries = object
    .children()
    .filter((child) => child.isNamed() && child.kind() !== "comment");
  for (const entry of entries) {
    if (
      entry.kind() === "pair" &&
      entry.field("key")?.kind() === "computed_property_name"
    )
      return null;
    if (
      entry.kind() !== "pair" &&
      entry.kind() !== "shorthand_property_identifier"
    )
      return null;
  }
  return entries;
}

function entryNamed(entries: Node[], name: string) {
  return entries.find((entry) => keyOf(entry) === name);
}

/** The object literal under `as const`, `satisfies T` and parentheses. */
function unwrap(node: Node | null | undefined): Node | null {
  let current = node ?? null;
  while (
    current &&
    [
      "satisfies_expression",
      "as_expression",
      "parenthesized_expression",
    ].includes(current.kind())
  ) {
    current = current.child(
      current.kind() === "parenthesized_expression" ? 1 : 0,
    );
  }
  return current;
}

// ---- Catalogs ----

/** One side of `createCatalog`: the definitions or the renderers. */
type Side =
  /** An object literal in the call, or a `const` used only there: inlined. */
  | { kind: "inline"; entries: Node[]; object: Node; declaration?: Node }
  /** A `const` with a literal that is also used elsewhere: read by name. */
  | { kind: "named"; name: string; entries: Node[] }
  /** Anything else with a name: names are unknown, members read by name. */
  | { kind: "opaque"; name: string };

/**
 * `ignore`: a declaration that the conversion deletes. References inside it
 * do not count, so `CatalogRenderers<typeof definitions>` does not keep
 * `definitions` from being inlined.
 */
function resolveSide(rootNode: Node, arg: Node, ignore?: Node): Side | null {
  const node = unwrap(arg);
  if (!node) return null;
  if (node.kind() === "object") {
    const entries = entriesOf(node);
    return entries ? { kind: "inline", entries, object: node } : null;
  }
  if (node.kind() === "member_expression")
    return { kind: "opaque", name: node.text() };
  if (node.kind() !== "identifier") return null;
  const name = node.text();
  const declarator = rootNode.find({
    rule: {
      kind: "variable_declarator",
      has: { field: "name", regex: `^${name.replace(/\$/g, "\\$")}$` },
    },
  });
  const declaration = declarator?.parent();
  const value = unwrap(declarator?.field("value"));
  const atTop =
    declaration?.kind() === "lexical_declaration" &&
    ["program", "export_statement"].includes(
      declaration.parent()?.kind() ?? "",
    );
  if (!declarator || !declaration || !atTop || value?.kind() !== "object")
    return { kind: "opaque", name };
  const entries = entriesOf(value);
  if (!entries) return { kind: "opaque", name };
  const inIgnored = (reference: Node) => {
    if (!ignore) return false;
    const start = reference.range().start.index;
    return (
      start >= ignore.range().start.index && start < ignore.range().end.index
    );
  };
  const used = references(rootNode, name).filter(
    (reference) =>
      reference.range().start.index !==
        declarator.field("name")!.range().start.index && !inIgnored(reference),
  ).length;
  const inline =
    used === 1 &&
    declaration.parent()?.kind() === "program" &&
    declaration
      .children()
      .filter((child) => child.kind() === "variable_declarator").length === 1;
  return inline
    ? { kind: "inline", entries, object: value, declaration }
    : { kind: "named", name, entries };
}

/**
 * The comments right before the entry `name` of an inlined side, moved to
 * `indent`, so inlining does not lose them.
 */
function commentsBefore(
  side: Side,
  name: string,
  source: string,
  indent: string,
): string[] {
  if (side.kind !== "inline") return [];
  const comments: Node[] = [];
  for (const child of side.object.children()) {
    if (child.kind() === "comment") {
      comments.push(child);
      continue;
    }
    if (!child.isNamed()) continue;
    if (keyOf(child) === name)
      return comments.map((comment) =>
        reindent(comment.text(), indentOf(comment, source), indent),
      );
    comments.length = 0;
  }
  return [];
}

function member(object: string, name: string) {
  return /^[A-Za-z_$][\w$]*$/.test(name)
    ? `${object}.${name}`
    : `${object}[${JSON.stringify(name)}]`;
}

/** The members of one component entry, and whether it has a description. */
function definitionMembers(
  side: Side,
  name: string,
  source: string,
  indent: string,
): { members: string[]; hasDescription: boolean | undefined } {
  if (side.kind === "opaque")
    return {
      members: [`...${member(side.name, name)}`],
      hasDescription: undefined,
    };
  const entry = entryNamed(side.entries, name);
  if (!entry) return { members: [], hasDescription: undefined };
  const value = unwrap(entry.kind() === "pair" ? entry.field("value") : entry);
  const entries = value?.kind() === "object" ? entriesOf(value) : null;
  const hasDescription = entries
    ? entryNamed(entries, "description") !== undefined
    : undefined;
  if (side.kind === "named")
    return { members: [`...${member(side.name, name)}`], hasDescription };
  if (!entries)
    return { members: [`...${value?.text() ?? name}`], hasDescription };
  return {
    members: entries.map((child) =>
      reindent(child.text(), indentOf(child, source), indent),
    ),
    hasDescription,
  };
}

function componentMember(
  side: Side,
  name: string,
  source: string,
  indent: string,
): string | undefined {
  if (side.kind === "opaque") return `component: ${member(side.name, name)}`;
  const entry = entryNamed(side.entries, name);
  if (!entry) return undefined;
  if (side.kind === "named") return `component: ${member(side.name, name)}`;
  const value = entry.kind() === "pair" ? entry.field("value") : entry;
  if (!value) return undefined;
  return `component: ${reindent(value.text(), indentOf(entry, source), indent)}`;
}

function namesOf(side: Side): string[] {
  if (side.kind === "opaque") return [];
  return side.entries.map((entry) => keyOf(entry)!);
}

interface CatalogOptions {
  id: string;
  extendsStandard: boolean;
}

function catalogOptions(
  arg: Node | undefined,
  defaultId: string,
): CatalogOptions | null {
  if (!arg) return { id: JSON.stringify(defaultId), extendsStandard: false };
  const object = unwrap(arg);
  if (object?.kind() !== "object") return null;
  const entries = entriesOf(object);
  if (!entries) return null;
  let id = JSON.stringify(defaultId);
  let extendsStandard = false;
  for (const entry of entries) {
    const key = keyOf(entry);
    const value = entry.kind() === "pair" ? entry.field("value") : entry;
    if (!value) return null;
    if (key === "catalogId") id = value.text();
    else if (key === "includeBasicCatalog") {
      if (value.text() === "true") extendsStandard = true;
      else if (value.text() !== "false") return null;
    } else return null;
  }
  return { id, extendsStandard };
}

/** `createCatalog(...)` and `createAngularCatalog(...)` to `createGenerativeUI({...})`. */
function catalogEdits(rootNode: Node, state: State): Edit[] {
  const source = rootNode.text();
  const edits: Edit[] = [];
  for (const factory of CATALOG_FACTORIES) {
    const locals = localsOf(rootNode, [factory.source], [factory.name]);
    for (const local of locals.keys()) {
      const calls = rootNode.findAll({
        rule: {
          kind: "call_expression",
          has: { field: "function", regex: `^${local}$` },
        },
      });
      for (const call of calls) {
        const converted = convertCatalog(
          rootNode,
          call,
          factory,
          source,
          state,
        );
        if (converted) {
          edits.push(...converted);
          continue;
        }
        const todo = todoAbove(enclosingStatement(call), source, CATALOG_NOTE);
        if (todo) edits.push(todo);
      }
    }
  }
  return edits;
}

function convertCatalog(
  rootNode: Node,
  call: Node,
  factory: (typeof CATALOG_FACTORIES)[number],
  source: string,
  state: State,
): Edit[] | null {
  const args = argumentNodes(call);
  if (args.length < 2 || args.length > 3) return null;
  const renderers = resolveSide(rootNode, args[1]!);
  const definitions = resolveSide(
    rootNode,
    args[0]!,
    renderers?.kind === "inline" ? renderers.declaration : undefined,
  );
  if (!definitions || !renderers) return null;
  if (definitions.kind === "opaque" && renderers.kind === "opaque") return null;
  const options = catalogOptions(args[2], factory.defaultId);
  if (!options) return null;

  const names = [...new Set([...namesOf(definitions), ...namesOf(renderers)])];
  if (names.length === 0) return null;

  const base = indentOf(enclosingStatement(call), source);
  const unit = "  ";
  const entryIndent = base + unit.repeat(2);
  const memberIndent = entryIndent + unit;
  const rendererNote =
    factory.framework === "angular" ? ANGULAR_COMPONENT_NOTE : RENDERER_NOTE;

  const components = names.map((name) => {
    const component = componentMember(renderers, name, source, memberIndent);
    const { members, hasDescription } = definitionMembers(
      definitions,
      name,
      source,
      memberIndent,
    );
    const todos = [
      ...commentsBefore(definitions, name, source, entryIndent),
      ...commentsBefore(renderers, name, source, entryIndent),
      ...[
        ...(component ? [rendererNote] : []),
        ...(hasDescription === false ? [DESCRIPTION_NOTE] : []),
      ].map((note) => `// ${TODO} ${note}`),
    ].map((line) => `${entryIndent}${line}\n`);
    const body = [...(component ? [component] : []), ...members]
      .map((text) => `${memberIndent}${text},\n`)
      .join("");
    return `${todos.join("")}${entryIndent}${propertyKey(name)}: {\n${body}${entryIndent}},\n`;
  });

  const framework = factory.framework;
  const from = GENERATIVE_UI_SOURCE[framework];
  need(state, from, "createGenerativeUI");
  if (options.extendsStandard) need(state, from, "standardUI");
  const config = [
    `${base}${unit}id: ${options.id},\n`,
    options.extendsStandard ? `${base}${unit}extends: [standardUI],\n` : "",
    `${base}${unit}components: {\n${components.join("")}${base}${unit}},\n`,
  ].join("");

  const edits: Edit[] = [
    call.replace(`createGenerativeUI({\n${config}${base}})`),
  ];
  for (const side of [definitions, renderers]) {
    if (side.kind === "inline" && side.declaration)
      edits.push(deleteLines(side.declaration, source));
  }
  return edits;
}

// ---- Prop schemas ----

/** Dynamic schemas, binding unions and `zod-v3`, in files of the v0.9 client. */
function schemaEdits(rootNode: Node, state: State): Edit[] {
  const imported = importsOf(rootNode);
  const isA2UIFile = imported.some((entry) => A2UI_SOURCES.has(entry.source));
  if (!isA2UIFile) return [];
  const source = rootNode.text();
  const edits: Edit[] = [];

  let z = zodName(rootNode);
  const zod = () => {
    if (z === undefined) {
      z = "z";
      need(state, "zod", "z");
    }
    return z;
  };

  for (const statement of rootNode.findAll({
    rule: { kind: "import_statement" },
  })) {
    const sourceNode = statement.field("source");
    if (sourceNode?.text().slice(1, -1) !== "zod-v3") continue;
    const quote = sourceNode.text()[0];
    edits.push(sourceNode.replace(`${quote}zod${quote}`));
  }

  const todoStatements = new Set<number>();
  for (const entry of imported) {
    const framework = FRAMEWORK_OF[entry.source];
    if (framework === undefined) continue;
    const schema = DYNAMIC_SCHEMAS[entry.name];
    const type = DYNAMIC_TYPES[entry.name];
    for (const reference of references(rootNode, entry.local)) {
      if (schema && reference.kind() === "identifier") {
        edits.push(reference.replace(schema(zod())));
      } else if (type && reference.kind() === "type_identifier") {
        edits.push(reference.replace(type));
      } else if (entry.name === "ChildListSchema") {
        need(state, GENERATIVE_UI_SOURCE[framework], "childList");
        edits.push(reference.replace("childList()"));
      } else if (UNMAPPED_SCHEMAS.has(entry.name)) {
        const statement = enclosingStatement(reference);
        if (todoStatements.has(statement.range().start.index)) continue;
        todoStatements.add(statement.range().start.index);
        const todo = todoAbove(statement, source, SCHEMA_NOTE);
        if (todo) edits.push(todo);
      }
    }
  }

  return edits;
}

/** Binding unions, in files of the v0.9 client. After `schemaEdits`, so the edits do not overlap. */
function unionEdits(rootNode: Node): Edit[] {
  const isA2UIFile = importsOf(rootNode).some((entry) =>
    A2UI_SOURCES.has(entry.source),
  );
  const z = zodName(rootNode);
  if (!isA2UIFile || z === undefined) return [];
  return bindingUnionEdits(rootNode, z);
}

/** `{ path: z.string() }` as v0.9 wrote a data binding. */
function isPathBinding(node: Node, z: string) {
  return (
    node.text().replace(/\s|,(?=\s*[})])/g, "") ===
    `${z}.object({path:${z}.string()})`
  );
}

/** `z.union([T, z.object({ path: z.string() })])` and `T.or(...)` become `T`. */
function bindingUnionEdits(rootNode: Node, z: string): Edit[] {
  const edits: Edit[] = [];
  for (const call of rootNode.findAll({ rule: { kind: "call_expression" } })) {
    const callee = call.field("function");
    const args = argumentNodes(call);
    if (callee?.text() === `${z}.union` && args.length === 1) {
      const array = args[0]!;
      if (array.kind() !== "array") continue;
      const items = array
        .children()
        .filter((child) => child.isNamed() && child.kind() !== "comment");
      if (items.length !== 2) continue;
      const plain = items.find((item) => !isPathBinding(item, z));
      if (plain && items.some((item) => isPathBinding(item, z)))
        edits.push(call.replace(plain.text()));
    } else if (
      callee?.kind() === "member_expression" &&
      callee.field("property")?.text() === "or" &&
      args.length === 1 &&
      isPathBinding(args[0]!, z)
    ) {
      const object = callee.field("object");
      if (object) edits.push(call.replace(object.text()));
    }
  }
  return edits;
}

// ---- Provider and runtime options ----

function configEdits(rootNode: Node, state: State): Edit[] {
  const source = rootNode.text();
  const basics = new Set<string>();
  for (const [sources, name] of BASIC_CATALOGS) {
    for (const local of localsOf(rootNode, sources, [name]).keys())
      basics.add(local);
  }
  return [
    ...providerEdits(rootNode, source, basics),
    ...angularEdits(rootNode, source, basics, state),
    ...runtimeEdits(rootNode, source),
  ];
}

/** The `catalog` of an `a2ui` object, and its other options. */
function splitA2UIConfig(entries: Node[], basics: Set<string>) {
  const catalogEntry = entryNamed(entries, "catalog");
  const catalogValue =
    catalogEntry?.kind() === "pair"
      ? catalogEntry.field("value")
      : catalogEntry;
  const catalog =
    catalogValue && !basics.has(catalogValue.text())
      ? catalogValue.text()
      : undefined;
  const others = entries.filter((entry) => entry !== catalogEntry);
  return { catalogEntry, catalog, others };
}

/** `<CopilotKitProvider a2ui={{ catalog }}>` to `generativeUI={{ ui: catalog }}`. */
function providerEdits(
  rootNode: Node,
  source: string,
  basics: Set<string>,
): Edit[] {
  const providers = localsOf(rootNode, PROVIDER_SOURCES, PROVIDER_NAMES);
  if (providers.size === 0) return [];
  const edits: Edit[] = [];
  // JSX kinds exist only in the tsx grammar; this finds nothing in a .ts file.
  const elements = (rootNode as unknown as SgNode<TSX>).findAll({
    rule: {
      any: [
        { kind: "jsx_opening_element" },
        { kind: "jsx_self_closing_element" },
      ],
    },
  }) as unknown as Node[];
  for (const element of elements) {
    const name = element.field("name")?.text();
    if (name === undefined || !providers.has(name)) continue;
    const attributes = element
      .children()
      .filter((child) => child.kind() === "jsx_attribute");
    const attribute = attributes.find(
      (child) => child.child(0)?.text() === "a2ui",
    );
    if (!attribute) continue;
    const hasGenerativeUI = attributes.some(
      (child) => child.child(0)?.text() === "generativeUI",
    );
    const value = attribute
      .children()
      .find((child) => child.kind() === "jsx_expression");
    const object = unwrap(
      value
        ?.children()
        .find((child) => child.isNamed() && child.kind() !== "comment"),
    );
    const entries = object?.kind() === "object" ? entriesOf(object) : null;
    if (!object || !entries) {
      const todo = todoBefore(attribute, source, PROVIDER_NOTE);
      if (todo) edits.push(todo);
      continue;
    }
    const { catalogEntry, catalog, others } = splitA2UIConfig(entries, basics);
    if (catalog !== undefined && hasGenerativeUI) {
      const todo = todoBefore(attribute, source, PROVIDER_NOTE);
      if (todo) edits.push(todo);
      continue;
    }
    if (others.length === 0) {
      edits.push(
        catalog === undefined
          ? deleteAttribute(attribute, source)
          : attribute.replace(`generativeUI={{ ui: ${catalog} }}`),
      );
      continue;
    }
    // Options with no 1:1 equivalent stay in `a2ui`, under a TODO, so the
    // type check points at them and a second run leaves them.
    const todo = todoBefore(attribute, source, PROVIDER_OPTIONS_NOTE);
    if (!todo) continue;
    const rest = catalogEntry
      ? `a2ui=${applyEdits(value!, [dropEntry(catalogEntry, source)])}`
      : attribute.text();
    edits.push(
      attribute.replace(
        catalog === undefined
          ? `${todo.insertedText}${rest}`
          : `generativeUI={{ ui: ${catalog} }} ${todo.insertedText}${rest}`,
      ),
    );
  }
  return edits;
}

/** `provideCopilotKit({ a2ui: { catalog } })` to `provideGenerativeUI({ ui: catalog })`. */
function angularEdits(
  rootNode: Node,
  source: string,
  basics: Set<string>,
  state: State,
): Edit[] {
  const locals = localsOf(
    rootNode,
    ["@copilotkit/angular"],
    ["provideCopilotKit"],
  );
  const edits: Edit[] = [];
  for (const local of locals.keys()) {
    const calls = rootNode.findAll({
      rule: {
        kind: "call_expression",
        has: { field: "function", regex: `^${local}$` },
      },
    });
    for (const call of calls) {
      const config = unwrap(argumentNodes(call)[0]);
      if (config?.kind() !== "object") continue;
      const configEntries = config
        .children()
        .filter((child) => child.isNamed() && child.kind() !== "comment");
      const entry = configEntries.find((child) => keyOf(child) === "a2ui");
      if (!entry) continue;
      const value = unwrap(
        entry.kind() === "pair" ? entry.field("value") : null,
      );
      const entries = value?.kind() === "object" ? entriesOf(value) : null;
      if (!value || !entries) {
        const todo = todoAbove(entry, source, ANGULAR_PROVIDER_NOTE);
        if (todo) edits.push(todo);
        continue;
      }
      const { catalogEntry, catalog, others } = splitA2UIConfig(
        entries,
        basics,
      );
      const array = call.parent();
      if (catalog !== undefined && array?.kind() !== "array") {
        const todo = todoAbove(entry, source, ANGULAR_PROVIDER_NOTE);
        if (todo) edits.push(todo);
        continue;
      }
      if (others.length === 0) {
        edits.push(dropEntry(entry, source));
      } else {
        const todo = todoAbove(entry, source, PROVIDER_OPTIONS_NOTE);
        if (!todo) continue;
        edits.push(todo);
        if (catalogEntry) edits.push(dropEntry(catalogEntry, source));
      }
      if (catalog === undefined) continue;
      need(state, GENERATIVE_UI_SOURCE.angular, "provideGenerativeUI");
      const end = call.range().end.index;
      const separator = array!.text().includes("\n")
        ? `,\n${indentOf(call, source)}`
        : ", ";
      edits.push({
        startPos: end,
        endPos: end,
        insertedText: `${separator}provideGenerativeUI({ ui: ${catalog} })`,
      });
    }
  }
  return edits;
}

/** `new CopilotRuntime({ a2ui: {...} })` to `generativeUI: { a2uiVersion: "0.9", ... }`. */
function runtimeEdits(rootNode: Node, source: string): Edit[] {
  const locals = localsOf(rootNode, RUNTIME_SOURCES, RUNTIME_CLASSES);
  const edits: Edit[] = [];
  for (const local of locals.keys()) {
    const constructions = rootNode.findAll({
      rule: {
        kind: "new_expression",
        has: { field: "constructor", regex: `^${local}$` },
      },
    });
    for (const construction of constructions) {
      const options = unwrap(argumentNodes(construction)[0]);
      if (options?.kind() !== "object") continue;
      const entries = options
        .children()
        .filter((child) => child.isNamed() && child.kind() !== "comment");
      const entry = entries.find((child) => keyOf(child) === "a2ui");
      if (!entry) continue;
      const generativeUI = entries.find(
        (child) => keyOf(child) === "generativeUI",
      );
      const moved = moveRuntimeOption(entry, generativeUI, source);
      if (moved) {
        edits.push(...moved);
        continue;
      }
      const todo = todoAbove(entry, source, RUNTIME_NOTE);
      if (todo) edits.push(todo);
    }
  }
  return edits;
}

function moveRuntimeOption(
  entry: Node,
  generativeUI: Node | undefined,
  source: string,
): Edit[] | null {
  const value = unwrap(entry.kind() === "pair" ? entry.field("value") : null);
  const members = value?.kind() === "object" ? entriesOf(value) : null;
  if (!value || !members) return null;
  const enabled = entryNamed(members, "enabled");
  const enabledValue =
    enabled?.kind() === "pair" ? enabled.field("value")?.text() : undefined;
  if (enabled && enabledValue !== "true" && enabledValue !== "false")
    return null;
  if (enabledValue === "false") return [dropEntry(entry, source)];
  const kept = members.filter((member) => member !== enabled);
  const version = 'a2uiVersion: "0.9"';

  if (generativeUI === undefined) {
    return [
      entry.field("key")!.replace("generativeUI"),
      value.replace(withFirst(value, version, kept, enabled, source)),
    ];
  }

  const target = unwrap(
    generativeUI.kind() === "pair" ? generativeUI.field("value") : null,
  );
  if (target?.text() === "true") {
    const merged = withFirst(value, version, kept, enabled, source);
    return [
      target.replace(
        reindent(
          merged,
          indentOf(entry, source),
          indentOf(generativeUI, source),
        ),
      ),
      dropEntry(entry, source),
    ];
  }
  if (target?.kind() !== "object") return null;
  const targetEntries = entriesOf(target);
  if (!targetEntries) return null;
  const taken = new Set(targetEntries.map((child) => keyOf(child)));
  if (
    taken.has("a2uiVersion") ||
    kept.some((member) => taken.has(keyOf(member)))
  )
    return null;
  const first = targetEntries[0];
  if (first === undefined || !target.text().includes("\n")) {
    const texts = [
      version,
      ...[...kept, ...targetEntries].map((m) => m.text()),
    ];
    return [
      target.replace(`{ ${texts.join(", ")} }`),
      dropEntry(entry, source),
    ];
  }
  const indent = indentOf(first, source);
  const texts = [
    version,
    ...kept.map((member) =>
      reindent(member.text(), indentOf(member, source), indent),
    ),
  ];
  const open = target.range().start.index + 1;
  return [
    {
      startPos: open,
      endPos: open,
      insertedText: texts.map((text) => `\n${indent}${text},`).join(""),
    },
    dropEntry(entry, source),
  ];
}

/**
 * The text of `object` with `text` as its first entry, keeping only the
 * entries in `kept` (`dropped`, if any, is deleted).
 */
function withFirst(
  object: Node,
  text: string,
  kept: Node[],
  dropped: Node | undefined,
  source: string,
): string {
  const first = kept[0];
  if (first === undefined || !object.text().includes("\n"))
    return `{ ${[text, ...kept.map((entry) => entry.text())].join(", ")} }`;
  const open = object.range().start.index + 1;
  return applyEdits(object, [
    ...(dropped ? [dropEntry(dropped, source)] : []),
    {
      startPos: open,
      endPos: open,
      insertedText: `\n${indentOf(first, source)}${text},`,
    },
  ]);
}

/**
 * Deletes an object entry with its comma. Unlike `removeEntry`, an entry
 * with code before it on its line keeps the space before it: `{ a, b }`
 * without `a` is `{ b }`.
 */
function dropEntry(entry: Node, source: string): Edit {
  const startChar = charIndex(source, entry.range().start.index);
  const endChar = charIndex(source, entry.range().end.index);
  const lineStart = source.lastIndexOf("\n", startChar - 1) + 1;
  const inline = source.slice(lineStart, startChar).trim() !== "";
  const after = /^\s*,[ \t]*/.exec(source.slice(endChar));
  if (inline && after && !after[0].includes("\n")) {
    return {
      startPos: entry.range().start.index,
      endPos: byteIndex(source, endChar + after[0].length),
      insertedText: "",
    };
  }
  return removeEntry(entry, source);
}
