import { parse } from "codemod:ast-grep";
import type { Edit, SgNode } from "codemod:ast-grep";
import { readFileSync, statSync } from "fs";
import { dirname, resolve } from "path";
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

export const RENDERER_NOTE = `This was a v0.9 renderer, which got \`{ props, children, dispatch }\`. A 2.0 component gets its resolved props directly, child components as slots or \`child()\` / \`childList()\` props, and calls an event or a function instead of \`dispatch\`. Rewrite it, and type its props (\`z.output\` of its schema): \`createGenerativeUI\` does not infer them. See ${GUIDE}#convert-a-custom-catalog`;
export const ANGULAR_COMPONENT_NOTE = `This was a v0.9 Angular component. In 2.0 it gets each prop as an input with its resolved value, child components as \`GenerativeUIChildren\` inputs, and an event input or a \`registerGenerativeUIFunction\` function replaces \`dispatch\` from \`injectA2UIComponentContext()\`. Update the component. See ${GUIDE}#convert-a-custom-catalog`;
export const DESCRIPTION_NOTE = `Add a \`description\` to this component. The agent reads it to choose the component. See ${GUIDE}#convert-a-custom-catalog`;
export const CATALOG_NOTE = `This v0.9 catalog could not be converted automatically. Rewrite it with \`createGenerativeUI({ id, extends: [standardUI], components })\`, one entry per component with \`component\`, \`description\` and plain \`props\`. See ${GUIDE}#convert-a-custom-catalog`;
export const SCHEMA_NOTE = `This v0.9 binding or action schema has no 2.0 equivalent. A bound prop takes its plain type (the engine resolves \`{ "@path" }\` before the component renders), and an action becomes an event that the component calls. See ${GUIDE}#bindings-and-actions`;
export const PROVIDER_NOTE = `The \`a2ui\` option was removed in 2.0. Pass \`generativeUI={{ ui }}\` with a UI from \`createGenerativeUI\`, or delete it to use the standard catalog. See ${GUIDE}#before-and-after`;
export const PROVIDER_OPTIONS_NOTE = `The \`a2ui\` option was removed in 2.0, and these options have no 1:1 equivalent: \`theme\` becomes the \`theme\` of the generative UI config (CSS variables), \`onAction\` becomes events or functions on the components, and \`loadingComponent\`, \`recovery\` and \`includeSchema\` are gone. Move what you need, then delete \`a2ui\`. See ${GUIDE}`;
export const ANGULAR_PROVIDER_NOTE = `The \`a2ui\` option was removed in 2.0. Add \`provideGenerativeUI({ ui })\` from "@copilotkit/angular/generative-ui" next to \`provideCopilotKit\`, with a UI from \`createGenerativeUI\`, and delete \`a2ui\`. See ${GUIDE}#before-and-after`;
export const PACKAGE_NOTE = `The A2UI v0.9 client (\`@copilotkit/a2ui-renderer\`, \`@copilotkit/angular/a2ui\`) was removed in 2.0. Use generative UI from the framework's \`/generative-ui\` entry: \`createGenerativeUI\` and \`standardUI\` for catalogs, \`GenerativeUISurface\` for a surface, and \`useGenerativeUIState\` and \`useGenerativeUIFunction\` for state and actions. Then delete this import. See ${GUIDE}`;
export const CHAT_RENDERER_NOTE = `The v0.9 chat renderer (\`createA2UIMessageRenderer\`, its option and action types, \`A2UITheme\`, \`a2uiDefaultTheme\`) was removed in 2.0. Generative UI renders the chat surfaces itself: delete the renderer and its \`renderActivityMessages\` entry, pass a wrapper component as \`<CopilotChat generativeUISurface>\`, and set colors with \`generativeUI.theme\`. See ${GUIDE}`;
export const ACTIVITY_NOTE = `2.0 sends A2UI surfaces as \`generative-ui-surface\` activities, with the A2UI 1.0 operations in \`content.operations\` (not \`a2ui_operations\`). When the runtime has generative UI on, \`a2ui-surface\` activities no longer reach the client, so this code never runs. See ${GUIDE}`;
export const MIDDLEWARE_NOTE = `2.0's runtime runs the A2UI middleware itself for \`generativeUI: { a2uiVersion: "0.9" }\`. Delete this one, or the agent gets two, and move its options (\`injectA2UITool\`, ...) to \`generativeUI\`. See ${GUIDE}#keep-a-v09-agent`;
export const A2UI_PACKAGES_NOTE = `CopilotKit 2.0 renders A2UI with generative UI and does not use the \`@a2ui/*\` renderers or their themes. Delete this import if it served the v0.9 client. See ${GUIDE}`;
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

/**
 * The components of `standardUI` in 2.0 (React and Angular). A v0.9
 * component with one of these names replaced the basic one; in 2.0 the
 * catalog drops the standard one with `standardUI.omit([...])`, because
 * `createGenerativeUI` throws when a name comes from two places.
 */
const STANDARD_COMPONENTS = new Set([
  "Box",
  "Column",
  "Row",
  "Grid",
  "GridItem",
  "Card",
  "Flow",
  "FlowItem",
  "Carousel",
  "CarouselItem",
  "CarouselMediaItem",
  "Spacer",
  "Divider",
  "Tabs",
  "Title",
  "Text",
  "Caption",
  "Label",
  "Bold",
  "Italic",
  "Underline",
  "Strikethrough",
  "Badge",
  "Blockquote",
  "Code",
  "Markdown",
  "Math",
  "ShimmerText",
  "Link",
  "Tooltip",
  "Button",
  "Pressable",
  "Form",
  "TextField",
  "TextArea",
  "Select",
  "CheckBox",
  "Radio",
  "RadioGroup",
  "Slider",
  "SegmentedControl",
  "ChoicePicker",
  "DateTimeInput",
  "PulseIndicator",
  "FlashcardFlip",
  "Popover",
  "PopoverTrigger",
  "PopoverContent",
  "Modal",
  "Table",
  "TableSection",
  "TableRow",
  "TableCell",
  "List",
  "ListItem",
  "Chart",
  "Map",
  "Image",
  "Icon",
  "Favicon",
  "Svg",
  "Video",
  "AudioPlayer",
  "HtmlView",
  "LinkCard",
  "Citation",
  "FollowUp",
  "EntityCard",
  "ImageGrid",
]);

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
  "CopilotKitRuntime",
  "CopilotKitSseRuntime",
  "CopilotKitIntelligenceRuntime",
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
  filename?: string,
): string | null {
  // A file that names A2UI, or that has a v0.9 binding or template shape.
  if (!/a2ui|\bpath\s*:|componentId/i.test(rootNode.text())) return null;
  const z = zodName(rootNode);
  const state: State = {
    imports: new Map(),
    changed: false,
    filename,
    // Decided on the original file: the steps remove the shapes it looks for.
    v09Schemas: z !== undefined && isV09SchemaFile(rootNode, z),
  };
  let current = rootNode;
  for (const step of [
    definitionsEdits,
    renderersEdits,
    catalogEdits,
    schemaEdits,
    unionEdits,
    zodRecordEdits,
    configEdits,
  ]) {
    const edits = step(current, state);
    if (edits.length === 0) continue;
    state.changed = true;
    current = reparse(current.commitEdits(edits));
  }
  if (state.changed) {
    const edits = importEdits(current, state);
    if (edits.length > 0) current = reparse(current.commitEdits(edits));
  }
  const todos = [...packageEdits(current), ...leftoverEdits(current)];
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

/** The A2UI exports of the 1.x \`react-core/v2\` entry that 2.0 removed. */
const REMOVED_CHAT_RENDERER = new Set([
  "createA2UIMessageRenderer",
  "A2UIMessageRendererOptions",
  "A2UIUserAction",
  "A2UIActionInterceptor",
  "A2UIRecoveryRendererOptions",
  "A2UITheme",
  "a2uiDefaultTheme",
]);

/**
 * TODOs for v0.9 code that the other steps do not convert: the removed chat
 * renderer, readers of the \`a2ui-surface\` activity, an app's own
 * \`A2UIMiddleware\`, \`@a2ui/*\` renderer imports, and renderers typed with
 * \`RendererProps\`. Only in files that use CopilotKit.
 */
function leftoverEdits(rootNode: Node): Edit[] {
  const imported = importsOf(rootNode);
  if (!imported.some((entry) => entry.source.startsWith("@copilotkit/")))
    return [];
  const source = rootNode.text();
  const edits: Edit[] = [];
  const done = new Set<number>();
  const add = (node: Node, note: string) => {
    const start = node.range().start.index;
    if (done.has(start)) return;
    done.add(start);
    const todo = todoAbove(node, source, note);
    if (todo) edits.push(todo);
  };
  for (const entry of imported) {
    if (
      REMOVED_CHAT_RENDERER.has(entry.name) &&
      (entry.source === "@copilotkit/react-core" ||
        entry.source === "@copilotkit/react-core/v2")
    )
      add(entry.statement, CHAT_RENDERER_NOTE);
    else if (entry.source.startsWith("@a2ui/"))
      add(entry.statement, A2UI_PACKAGES_NOTE);
  }
  for (const statement of rootNode.findAll({
    rule: { kind: "import_statement" },
  })) {
    const from = statement.field("source")?.text().slice(1, -1) ?? "";
    // A namespace or default import of an @a2ui package has no specifier.
    if (from.startsWith("@a2ui/")) add(statement, A2UI_PACKAGES_NOTE);
  }
  for (const literal of rootNode.findAll({
    rule: { kind: "string", regex: "^[\"'`]a2ui-surface[\"'`]$" },
  }))
    add(enclosingStatement(literal), ACTIVITY_NOTE);
  for (const local of localsOf(
    rootNode,
    ["@ag-ui/a2ui-middleware"],
    ["A2UIMiddleware"],
  ).keys()) {
    for (const construction of rootNode.findAll({
      rule: {
        kind: "new_expression",
        has: { field: "constructor", regex: `^${local}$` },
      },
    }))
      add(enclosingStatement(construction), MIDDLEWARE_NOTE);
  }
  for (const [local, framework] of a2uiLocals(rootNode, "RendererProps")) {
    for (const reference of references(rootNode, local)) {
      if (reference.kind() !== "type_identifier") continue;
      add(
        enclosingStatement(reference),
        framework === "angular" ? ANGULAR_COMPONENT_NOTE : RENDERER_NOTE,
      );
    }
  }
  return edits;
}

interface State {
  /** Imports to add: names by source. */
  imports: Map<string, Set<string>>;
  changed: boolean;
  /** The path of the file, to read the modules it imports. */
  filename?: string;
  /** Whether the file has v0.9 prop schemas (see `isV09SchemaFile`). */
  v09Schemas: boolean;
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

// ---- Definitions and renderers modules ----

/** The local names of `name` imported from the v0.9 client, with their framework. */
function a2uiLocals(rootNode: Node, name: string): Map<string, Framework> {
  const locals = new Map<string, Framework>();
  for (const entry of importsOf(rootNode)) {
    const framework = FRAMEWORK_OF[entry.source];
    if (framework !== undefined && entry.name === name)
      locals.set(entry.local, framework);
  }
  return locals;
}

/**
 * Object literals typed with the v0.9 type `name`, as `const x: T = {...}`
 * or `{...} satisfies T`, with the edit that deletes the type.
 */
function typedObjects(
  rootNode: Node,
  name: string,
): { object: Node; framework: Framework; untype: Edit }[] {
  const result: { object: Node; framework: Framework; untype: Edit }[] = [];
  for (const [local, framework] of a2uiLocals(rootNode, name)) {
    for (const reference of references(rootNode, local)) {
      if (reference.kind() !== "type_identifier") continue;
      const type =
        reference.parent()?.kind() === "generic_type"
          ? reference.parent()!
          : reference;
      const holder = type.parent();
      if (holder?.kind() === "satisfies_expression") {
        const expression = holder.child(0);
        const object = unwrap(expression);
        if (!expression || object?.kind() !== "object") continue;
        result.push({
          object,
          framework,
          untype: {
            startPos: expression.range().end.index,
            endPos: holder.range().end.index,
            insertedText: "",
          },
        });
      } else if (
        holder?.kind() === "type_annotation" &&
        holder.parent()?.kind() === "variable_declarator"
      ) {
        const object = unwrap(holder.parent()!.field("value"));
        if (object?.kind() !== "object") continue;
        result.push({
          object,
          framework,
          untype: {
            startPos: holder.range().start.index,
            endPos: holder.range().end.index,
            insertedText: "",
          },
        });
      }
    }
  }
  return result;
}

/**
 * A `.describe()` argument without the v0.9 `REF:<ref>|` marker: the text
 * after `|` as a string literal, `undefined` for a bare marker, and any
 * other argument as written.
 */
function withoutRefMarker(arg: Node): string | undefined {
  const text = arg.text();
  if (arg.kind() !== "string") return text;
  const value = text.slice(1, -1);
  if (!value.startsWith("REF:")) return text;
  const bar = value.indexOf("|");
  if (bar === -1) return undefined;
  return `${text[0]}${value.slice(bar + 1)}${text[0]}`;
}

/**
 * The callee of a call without whitespace: `z\n  .union` is `z.union`.
 * `undefined` for a node that is not a call.
 */
function calleeOf(node: Node | null | undefined): string | undefined {
  if (node?.kind() !== "call_expression") return undefined;
  return node.field("function")?.text().replace(/\s/g, "");
}

/**
 * A prop schema without its trailing `.optional()` and `.describe(text)`
 * calls: the base schema, whether it was optional, the description, and
 * the common type a v0.9 `REF:common_types.json#/$defs/<type>` marker
 * names (`ComponentId`, `ChildList`, `Action`, ...).
 */
function peelSchema(schema: Node): {
  base: Node;
  optional: boolean;
  description?: string;
  ref?: string;
} {
  let base = schema;
  let optional = false;
  let description: string | undefined;
  let ref: string | undefined;
  for (;;) {
    const callee =
      base.kind() === "call_expression" ? base.field("function") : null;
    const object = callee?.field("object");
    if (callee?.kind() !== "member_expression" || !object) break;
    const method = callee.field("property")?.text();
    const args = argumentNodes(base);
    if (method === "optional" && args.length === 0 && !optional) {
      optional = true;
    } else if (
      method === "describe" &&
      args.length === 1 &&
      description === undefined
    ) {
      description = withoutRefMarker(args[0]!);
      ref ??= /^["'`]REF:[^"'`|]*#\/\$defs\/(\w+)/.exec(args[0]!.text())?.[1];
    } else break;
    base = object;
  }
  return { base, optional, description, ref };
}

/** The comments right before `entry` in `object`, with nothing between. */
function leadingComments(object: Node, entry: Node): Node[] {
  const comments: Node[] = [];
  for (const child of object.children()) {
    if (child.kind() === "comment") {
      comments.push(child);
      continue;
    }
    if (child.range().start.index === entry.range().start.index)
      return comments;
    if (child.isNamed()) comments.length = 0;
  }
  return [];
}

/**
 * The v0.9 conventions in the props of one component definition:
 * `children: z.array(z.string())` is a child list and `child: z.string()`
 * a child, which the v0.9 renderer drew with `children(id)`. An `action`
 * prop with a schema that is not a plain value was passed to `dispatch`;
 * in 2.0 it is an event. The runtime turns a v0.9 action into an event
 * binding under the same name, except `Button.action`, which becomes
 * `onClick` (the name of the standard Button), so a `Button` gets the
 * event `onClick`.
 */
function definitionEdits(
  entry: Node,
  z: string,
  actionSchemas: Set<string>,
  framework: Framework,
  source: string,
  state: State,
  /** Counts the identifiers that a moved action prop used as its schema. */
  movedSchemas: Map<string, number>,
): Edit[] {
  const value = unwrap(entry.kind() === "pair" ? entry.field("value") : null);
  const fields = value?.kind() === "object" ? entriesOf(value) : null;
  if (!fields) return [];
  const propsEntry = entryNamed(fields, "props");
  const propsValue =
    propsEntry?.kind() === "pair" ? propsEntry.field("value") : null;
  if (
    !propsEntry ||
    propsValue?.kind() !== "call_expression" ||
    calleeOf(propsValue) !== `${z}.object`
  )
    return [];
  const shape = unwrap(argumentNodes(propsValue)[0]);
  const props = shape?.kind() === "object" ? entriesOf(shape) : null;
  if (!props) return [];
  const from = GENERATIVE_UI_SOURCE[framework];
  const plain = new RegExp(
    `^${z.replace(/\$/g, "\\$")}\\.(string|number|boolean|enum|literal)\\(`,
  );
  const edits: Edit[] = [];
  for (const prop of props) {
    if (prop.kind() !== "pair") continue;
    const schema = prop.field("value");
    if (!schema) continue;
    const { base, optional, description, ref } = peelSchema(schema);
    const compact = base.text().replace(/\s/g, "");
    const suffix = optional ? ".optional()" : "";
    const key = keyOf(prop);
    if (
      ref === "ChildList" ||
      (key === "children" &&
        (compact === `${z}.array(${z}.string())` ||
          isTemplateChildUnion(base, z)))
    ) {
      need(state, from, "childList");
      edits.push(schema.replace(`childList(${description ?? ""})${suffix}`));
    } else if (
      ref === "ComponentId" ||
      (key === "child" && compact === `${z}.string()`)
    ) {
      need(state, from, "child");
      edits.push(schema.replace(`child(${description ?? ""})${suffix}`));
    } else if (
      (ref === "Action" ||
        (key === "action" &&
          (actionSchemas.has(compact) || !plain.test(compact)))) &&
      entryNamed(fields, "events") === undefined
    ) {
      const name =
        keyOf(entry) === "Button" && key === "action" ? "onClick" : key;
      // An event that matches no declared function needs its parameters.
      const parameters = `parameters: ${z}.object({})`;
      const event =
        description === undefined
          ? `{ ${parameters} }`
          : `{ description: ${description}, ${parameters} }`;
      edits.push(removeEntry(prop, source));
      if (/^[A-Za-z_$][\w$]*$/.test(compact))
        movedSchemas.set(compact, (movedSchemas.get(compact) ?? 0) + 1);
      // The comments right above the prop describe it: they go with it.
      for (const comment of leadingComments(shape!, prop))
        edits.push(deleteLines(comment, source));
      const end = propsEntry.range().end.index;
      edits.push({
        startPos: end,
        endPos: end,
        insertedText: `,\n${indentOf(propsEntry, source)}events: { ${name}: ${event} }`,
      });
    }
  }
  return edits;
}

/**
 * A top-level `const` that holds a v0.9 child reference and that only
 * `children` or `child` props of the definitions use, such as
 * `const childrenRef = z.array(z.string())` with `children: childrenRef`.
 * Its value becomes `childList()` or `child()`; a description stays.
 */
function childRefConstEdits(
  rootNode: Node,
  z: string,
  objects: Map<number, { object: Node; framework: Framework }>,
  state: State,
): Edit[] {
  const edits: Edit[] = [];
  /** By const name: the role of each use, and the framework. */
  const uses = new Map<string, { roles: Set<string>; framework: Framework }>();
  for (const { object, framework } of objects.values()) {
    for (const entry of entriesOf(object) ?? []) {
      const value = unwrap(
        entry.kind() === "pair" ? entry.field("value") : null,
      );
      const fields = value?.kind() === "object" ? entriesOf(value) : null;
      const props = fields && entryNamed(fields, "props");
      const call = props?.kind() === "pair" ? props.field("value") : null;
      if (calleeOf(call) !== `${z}.object`) continue;
      const shape = unwrap(argumentNodes(call!)[0]);
      for (const prop of (shape?.kind() === "object" && entriesOf(shape)) ||
        []) {
        if (prop.kind() !== "pair") continue;
        const schema = prop.field("value");
        if (!schema) continue;
        const { base } = peelSchema(schema);
        if (base.kind() !== "identifier") continue;
        const record = uses.get(base.text()) ?? {
          roles: new Set<string>(),
          framework,
        };
        record.roles.add(keyOf(prop) ?? "");
        uses.set(base.text(), record);
      }
    }
  }
  for (const [name, { roles, framework }] of uses) {
    const declarator = rootNode.find({
      rule: {
        kind: "variable_declarator",
        has: { field: "name", regex: `^${name.replace(/\$/g, "\\$")}$` },
      },
    });
    const declaration = declarator?.parent();
    const init = declarator?.field("value");
    if (
      !declarator ||
      !init ||
      declaration?.kind() !== "lexical_declaration" ||
      !["program", "export_statement"].includes(
        declaration.parent()?.kind() ?? "",
      )
    )
      continue;
    const { base, optional, description, ref } = peelSchema(init);
    const compact = base.text().replace(/\s/g, "");
    const suffix = optional ? ".optional()" : "";
    // Every use outside the definitions would keep the old meaning.
    const declaredAt = declarator.field("name")!.range().start.index;
    const outside = references(rootNode, name).filter(
      (reference) => reference.range().start.index !== declaredAt,
    ).length;
    const inProps = [...roles].length > 0;
    const from = GENERATIVE_UI_SOURCE[framework];
    const isList =
      ref === "ChildList" ||
      (roles.size === 1 &&
        roles.has("children") &&
        (compact === `${z}.array(${z}.string())` ||
          isTemplateChildUnion(base, z)));
    const isChild =
      ref === "ComponentId" ||
      (roles.size === 1 && roles.has("child") && compact === `${z}.string()`);
    if (!inProps || outside === 0) continue;
    if (!isList && !isChild) continue;
    // Only when the definitions are the only users of the const.
    const propUses = rootNode
      .findAll({ rule: { kind: "identifier", regex: `^${name}$` } })
      .filter((reference) => {
        if (reference.range().start.index === declaredAt) return false;
        let node: Node | null = reference;
        while (
          node?.parent() &&
          ["member_expression", "call_expression", "arguments"].includes(
            node.parent()!.kind(),
          )
        )
          node = node.parent();
        const pair = node?.parent();
        return (
          pair?.kind() === "pair" &&
          ["children", "child"].includes(keyOf(pair) ?? "")
        );
      }).length;
    if (propUses !== outside) continue;
    const helper = isList ? "childList" : "child";
    need(state, from, helper);
    edits.push(init.replace(`${helper}(${description ?? ""})${suffix}`));
  }
  return edits;
}

/**
 * A v0.9 definitions object (typed `CatalogDefinitions`, or the definitions
 * of a `createCatalog` call in the file): the type goes, and the props of
 * each component follow the 2.0 conventions (see `definitionEdits`).
 */
function definitionsEdits(rootNode: Node, state: State): Edit[] {
  const source = rootNode.text();
  const z = zodName(rootNode);
  const actionSchemas = new Set(a2uiLocals(rootNode, "ActionSchema").keys());
  const edits: Edit[] = [];
  const objects = new Map<number, { object: Node; framework: Framework }>();
  for (const { object, framework, untype } of typedObjects(
    rootNode,
    "CatalogDefinitions",
  )) {
    edits.push(untype);
    objects.set(object.range().start.index, { object, framework });
  }
  for (const factory of CATALOG_FACTORIES) {
    for (const local of localsOf(
      rootNode,
      [factory.source],
      [factory.name],
    ).keys()) {
      for (const call of rootNode.findAll({
        rule: {
          kind: "call_expression",
          has: { field: "function", regex: `^${local}$` },
        },
      })) {
        const first = argumentNodes(call)[0];
        const side = first && resolveSide(rootNode, first);
        const object =
          side?.kind === "inline"
            ? side.object
            : side?.kind === "named"
              ? side.entries[0]?.parent()
              : undefined;
        if (object)
          objects.set(object.range().start.index, {
            object,
            framework: factory.framework,
          });
      }
    }
  }
  if (z === undefined) return edits;
  if (state.v09Schemas) {
    const framework = frameworkOf(rootNode);
    for (const object of exportedDefinitionObjects(rootNode, z)) {
      const start = object.range().start.index;
      if (!objects.has(start)) objects.set(start, { object, framework });
    }
  }
  const movedSchemas = new Map<string, number>();
  for (const { object, framework } of objects.values()) {
    for (const entry of entriesOf(object) ?? []) {
      edits.push(
        ...definitionEdits(
          entry,
          z,
          actionSchemas,
          framework,
          source,
          state,
          movedSchemas,
        ),
      );
    }
  }
  edits.push(...childRefConstEdits(rootNode, z, objects, state));
  // A local action schema that only the moved props used goes too, with
  // the comments above it.
  for (const [name, moved] of movedSchemas) {
    if (actionSchemas.has(name)) continue;
    const declarator = rootNode.find({
      rule: {
        kind: "variable_declarator",
        has: { field: "name", regex: `^${name.replace(/\$/g, "\\$")}$` },
      },
    });
    const declaration = declarator?.parent();
    if (
      !declarator ||
      declaration?.kind() !== "lexical_declaration" ||
      declaration.parent()?.kind() !== "program" ||
      declaration
        .children()
        .filter((child) => child.kind() === "variable_declarator").length !== 1
    )
      continue;
    const uses = references(rootNode, name).filter(
      (reference) =>
        reference.range().start.index !==
        declarator.field("name")!.range().start.index,
    ).length;
    if (uses !== moved) continue;
    // One edit from the first comment to the end of the declaration, so
    // that no blank lines pile up where they were.
    const first = leadingComments(rootNode, declaration)[0] ?? declaration;
    let start = charIndex(source, first.range().start.index);
    let end = charIndex(source, declaration.range().end.index);
    while (start > 0 && /[ \t]/.test(source[start - 1]!)) start--;
    if (source[end] === "\n") end++;
    if (
      source[end] === "\n" &&
      (start === 0 || source.slice(0, start).endsWith("\n\n"))
    )
      end++;
    edits.push({
      startPos: byteIndex(source, start),
      endPos: byteIndex(source, end),
      insertedText: "",
    });
  }
  return edits;
}

/**
 * A v0.9 renderers object in its own module (typed `CatalogRenderers`): the
 * type goes, and each renderer gets the TODO to rewrite it. A renderers
 * object that a `createCatalog` call of the same file uses gets its TODOs
 * from `catalogEdits`.
 */
function renderersEdits(rootNode: Node): Edit[] {
  const hasCatalog = CATALOG_FACTORIES.some(
    (factory) => localsOf(rootNode, [factory.source], [factory.name]).size > 0,
  );
  if (hasCatalog) return [];
  const source = rootNode.text();
  const edits: Edit[] = [];
  for (const { object, framework, untype } of typedObjects(
    rootNode,
    "CatalogRenderers",
  )) {
    edits.push(untype);
    const note =
      framework === "angular" ? ANGULAR_COMPONENT_NOTE : RENDERER_NOTE;
    for (const entry of entriesOf(object) ?? []) {
      const todo = todoAbove(entry, source, note);
      if (todo) edits.push(todo);
    }
  }
  return edits;
}

// ---- Catalogs ----

/** One side of `createCatalog`: the definitions or the renderers. */
type Side =
  /** An object literal in the call, or a `const` used only there: inlined. */
  | { kind: "inline"; entries: Node[]; object: Node; declaration?: Node }
  /**
   * A `const` with a literal that is also used elsewhere, or that another
   * module of the app exports: read by name. `external` is set for an
   * imported one: its renderers get their TODO in their own module.
   */
  | { kind: "named"; name: string; entries: Node[]; external?: boolean }
  /** Anything else with a name: names are unknown, members read by name. */
  | { kind: "opaque"; name: string };

/** Extensions a relative import can leave out, in the order bundlers try them. */
const MODULE_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  "/index.ts",
  "/index.tsx",
  "/index.js",
];

/** The parsed module that `specifier` points to from `filename`, or `null`. */
function readModule(
  filename: string | undefined,
  specifier: string,
): Node | null {
  if (!filename || !specifier.startsWith(".")) return null;
  const base = resolve(dirname(filename), specifier);
  for (const suffix of MODULE_SUFFIXES) {
    const path = base + suffix;
    if (!/\.[mc]?[jt]sx?$/.test(path)) continue;
    let text: string;
    try {
      if (!statSync(path).isFile()) continue;
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    // `.ts` files go through the TypeScript grammar: in TSX, `<T>value`
    // parses as JSX.
    const language = /\.[mc]?ts$/.test(path) ? "typescript" : "tsx";
    return parse(language, text).root() as unknown as Node;
  }
  return null;
}

/**
 * The entries of the object literal that another module of the app exports
 * as the import `local`: `import { definitions } from "./definitions"`.
 * `null` when the module cannot be read or does not export a literal.
 */
function importedObject(
  rootNode: Node,
  local: string,
  filename: string | undefined,
): Node[] | null {
  const imported = importsOf(rootNode).find((entry) => entry.local === local);
  if (!imported) return null;
  const module = readModule(filename, imported.source);
  if (!module) return null;
  for (const declarator of module.findAll({
    rule: {
      kind: "variable_declarator",
      has: {
        field: "name",
        regex: `^${imported.name.replace(/\$/g, "\\$")}$`,
      },
      inside: { kind: "export_statement", stopBy: "end" },
    },
  })) {
    const value = unwrap(declarator.field("value"));
    if (value?.kind() !== "object") continue;
    return entriesOf(value);
  }
  return null;
}

/**
 * `ignore`: a declaration that the conversion deletes. References inside it
 * do not count, so `CatalogRenderers<typeof definitions>` does not keep
 * `definitions` from being inlined.
 */
function resolveSide(
  rootNode: Node,
  arg: Node,
  ignore?: Node,
  filename?: string,
): Side | null {
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
  if (!declarator) {
    const imported = importedObject(rootNode, name, filename);
    return imported
      ? { kind: "named", name, entries: imported, external: true }
      : { kind: "opaque", name };
  }
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
  const renderers = resolveSide(rootNode, args[1]!, undefined, state.filename);
  const definitions = resolveSide(
    rootNode,
    args[0]!,
    renderers?.kind === "inline" ? renderers.declaration : undefined,
    state.filename,
  );
  if (!definitions || !renderers) return null;
  if (definitions.kind === "opaque" && renderers.kind === "opaque") return null;
  const options = catalogOptions(args[2], factory.defaultId);
  if (!options) return null;

  const names = [...new Set([...namesOf(definitions), ...namesOf(renderers)])];
  // No names is only safe when both sides are written out empty: `{}`.
  if (
    names.length === 0 &&
    !(definitions.kind === "inline" && renderers.kind === "inline")
  )
    return null;

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
        // An imported renderer gets its TODO in its own module.
        ...(component && !(renderers.kind === "named" && renderers.external)
          ? [rendererNote]
          : []),
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
  const replaced = names.filter((name) => STANDARD_COMPONENTS.has(name));
  const standard =
    replaced.length > 0
      ? `standardUI.omit([${replaced.map((name) => JSON.stringify(name)).join(", ")}])`
      : "standardUI";
  const config = [
    `${base}${unit}id: ${options.id},\n`,
    options.extendsStandard ? `${base}${unit}extends: [${standard}],\n` : "",
    components.length === 0
      ? `${base}${unit}components: {},\n`
      : `${base}${unit}components: {\n${components.join("")}${base}${unit}},\n`,
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
function unionEdits(rootNode: Node, state: State): Edit[] {
  const z = zodName(rootNode);
  if (z === undefined || !state.v09Schemas) return [];
  return bindingUnionEdits(rootNode, z);
}

/** One-argument `z.record` in v0.9 schema files. After `unionEdits`, so the edits do not overlap. */
function zodRecordEdits(rootNode: Node, state: State): Edit[] {
  const z = zodName(rootNode);
  if (z === undefined || !state.v09Schemas) return [];
  return [...recordEdits(rootNode, z), ...refMarkerEdits(rootNode)];
}

/**
 * `.describe("REF:<ref>|<description>")` was a v0.9 marker that the v0.9
 * schema export turned into a `$ref`. 2.0 passes a description as is, so
 * the marker goes and the description after `|` stays.
 */
function refMarkerEdits(rootNode: Node): Edit[] {
  const edits: Edit[] = [];
  for (const call of rootNode.findAll({ rule: { kind: "call_expression" } })) {
    const callee = call.field("function");
    const object = callee?.field("object");
    if (
      callee?.kind() !== "member_expression" ||
      callee.field("property")?.text() !== "describe" ||
      !object
    )
      continue;
    const args = argumentNodes(call);
    if (args.length !== 1 || args[0]!.kind() !== "string") continue;
    const text = args[0]!.text();
    const quote = text[0]!;
    const value = text.slice(1, -1);
    if (!value.startsWith("REF:")) continue;
    const bar = value.indexOf("|");
    edits.push(
      bar === -1
        ? call.replace(object.text())
        : args[0]!.replace(`${quote}${value.slice(bar + 1)}${quote}`),
    );
  }
  return edits;
}

/**
 * A file of v0.9 prop schemas: it imports the v0.9 client, or it uses a
 * shape that only the v0.9 binder read (a union with a `{ path }` binding,
 * or the `{ componentId, path }` template of a child list).
 */
function isV09SchemaFile(rootNode: Node, z: string) {
  if (importsOf(rootNode).some((entry) => A2UI_SOURCES.has(entry.source)))
    return true;
  return rootNode
    .findAll({ rule: { kind: "call_expression" } })
    .some((call) => isBindingUnion(call, z) || isTemplateObject(call, z));
}

/** `z.union([T, { path }])` or `T.or({ path })`: a v0.9 bound prop. */
function isBindingUnion(call: Node, z: string) {
  const callee = call.field("function");
  const args = argumentNodes(call);
  if (calleeOf(call) === `${z}.union` && args[0]?.kind() === "array") {
    return args[0]
      .children()
      .some((item) => item.isNamed() && isPathBinding(item, z));
  }
  return (
    callee?.kind() === "member_expression" &&
    callee.field("property")?.text() === "or" &&
    args.length === 1 &&
    isPathBinding(args[0]!, z)
  );
}

/** The framework of a file without a v0.9 import: Angular when it uses Angular. */
function frameworkOf(rootNode: Node): Framework {
  for (const entry of importsOf(rootNode)) {
    const framework = FRAMEWORK_OF[entry.source];
    if (framework) return framework;
    if (
      entry.source.startsWith("@angular/") ||
      entry.source.startsWith("@copilotkit/angular")
    )
      return "angular";
  }
  return "react";
}

/**
 * The top-level object literals whose entries are all v0.9 component
 * definitions (`{ ..., props: z.object(...) }`).
 */
function exportedDefinitionObjects(rootNode: Node, z: string): Node[] {
  const result: Node[] = [];
  for (const declarator of rootNode.findAll({
    rule: { kind: "variable_declarator" },
  })) {
    const declaration = declarator.parent();
    if (
      declaration?.kind() !== "lexical_declaration" ||
      !["program", "export_statement"].includes(
        declaration.parent()?.kind() ?? "",
      )
    )
      continue;
    const object = unwrap(declarator.field("value"));
    const entries = object?.kind() === "object" ? entriesOf(object) : null;
    if (!object || !entries || entries.length === 0) continue;
    const isDefinition = (entry: Node) => {
      const value = unwrap(
        entry.kind() === "pair" ? entry.field("value") : null,
      );
      const fields = value?.kind() === "object" ? entriesOf(value) : null;
      const props = fields && entryNamed(fields, "props");
      return (
        props?.kind() === "pair" &&
        calleeOf(props.field("value")) === `${z}.object`
      );
    };
    if (entries.every(isDefinition)) result.push(object);
  }
  return result;
}

/** `z.object({ componentId: z.string(), path: z.string() })`: a v0.9 template. */
function isTemplateObject(node: Node, z: string) {
  const text = node.text().replace(/\s|,(?=\s*[})])/g, "");
  return (
    text === `${z}.object({componentId:${z}.string(),path:${z}.string()})` ||
    text === `${z}.object({path:${z}.string(),componentId:${z}.string()})`
  );
}

/** `z.union([z.array(z.string()), <template>])`: a v0.9 child list. */
function isTemplateChildUnion(node: Node, z: string) {
  if (node.kind() !== "call_expression" || calleeOf(node) !== `${z}.union`)
    return false;
  const array = argumentNodes(node)[0];
  if (array?.kind() !== "array") return false;
  const items = array
    .children()
    .filter((child) => child.isNamed() && child.kind() !== "comment");
  return (
    items.length === 2 &&
    items.some(
      (item) => item.text().replace(/\s/g, "") === `${z}.array(${z}.string())`,
    ) &&
    items.some((item) => isTemplateObject(item, z))
  );
}

/**
 * `z.record(value)` with one argument is Zod 3. 2.0 reads the schemas with
 * Zod 4, which needs the key schema: `z.record(z.string(), value)`.
 */
function recordEdits(rootNode: Node, z: string): Edit[] {
  const edits: Edit[] = [];
  for (const call of rootNode.findAll({ rule: { kind: "call_expression" } })) {
    if (calleeOf(call) !== `${z}.record`) continue;
    const args = argumentNodes(call);
    if (args.length !== 1) continue;
    const start = args[0]!.range().start.index;
    edits.push({
      startPos: start,
      endPos: start,
      insertedText: `${z}.string(), `,
    });
  }
  return edits;
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
    if (calleeOf(call) === `${z}.union` && args.length === 1) {
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
