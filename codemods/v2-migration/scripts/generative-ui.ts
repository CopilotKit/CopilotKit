import type { Edit, SgNode } from "codemod:ast-grep";
import type TS from "codemod:ast-grep/langs/typescript";
import type TSX from "codemod:ast-grep/langs/tsx";

type Node = SgNode<TS | TSX>;

const TODO = "TODO(copilotkit-2.0):";
const GUIDE = "https://docs.copilotkit.ai/migrate/generative-ui-2.0";

/**
 * The Open Generative UI schemas that were zod objects in 1.x and are
 * Standard Schemas in 2.0, by the package that exports them.
 */
const OGUI_SCHEMA_NAMES = [
  "OpenGenerativeUIContentSchema",
  "GenerateSandboxedUiArgsSchema",
];
const OGUI_SCHEMA_SOURCES = new Set([
  "@copilotkit/vue",
  "@copilotkit/vue/v2",
  "@copilotkit/angular",
]);

/** zod methods that validate a value. */
const PARSE_METHODS = new Set([
  "parse",
  "safeParse",
  "parseAsync",
  "safeParseAsync",
]);

/** A call that builds a zod schema from other schemas. */
const ZOD_COMPOSITION = /^(z|zod)\.|\.(extend|merge|and|or|pipe)$/;

/** `filterCatalog` was removed with the v0.9 client. */
const FILTER_CATALOG_SOURCES = new Set(["@copilotkit/a2ui-renderer"]);

/** Members of Angular's `CopilotA2UIRecovery` that 2.0 removed. */
const RECOVERY_MEMBERS =
  /\.(lifecycle|retryRevealed|debugExposure|label|phase|failureDiagnostics|retryDiagnostics)\(\)/;

/** The Open Generative UI placeholder test id that 2.0 removed. */
const OGUI_PLACEHOLDER_TEST_ID = "open-generative-ui-placeholder";

/** Node kinds whose children are statements; a TODO goes above such a child. */
const STATEMENT_PARENTS = new Set([
  "program",
  "statement_block",
  "class_body",
  "switch_case",
  "switch_default",
]);

function parseNote(name: string, method: string) {
  return `\`${name}\` is a Standard Schema in 2.0, not a zod schema, so \`.${method}()\` does not exist. Use \`${name}["~standard"].validate(value)\`: it returns \`{ value }\` or \`{ issues }\` and does not throw. See ${GUIDE}`;
}

function memberNote(name: string, member: string) {
  return `\`${name}\` is a Standard Schema in 2.0, not a zod schema, so \`.${member}\` does not exist. It has only \`["~standard"]\`. See ${GUIDE}`;
}

function compositionNote(name: string) {
  return `\`${name}\` is a Standard Schema in 2.0, not a zod schema, so it cannot be part of a zod schema. Write the fields in zod yourself, or validate with \`${name}["~standard"].validate(value)\`. See ${GUIDE}`;
}

const FILTER_CATALOG_NOTE = `\`filterCatalog\` was removed with \`@copilotkit/a2ui-renderer\` in 2.0. To drop standard components, use \`extends: [standardUI.omit(["Name"])]\` in \`createGenerativeUI\`. To limit your own components, pass \`createGenerativeUI\` only the components you want. See https://docs.copilotkit.ai/generative-ui/components/standard-catalog#drop-components`;

const RECOVERY_NOTE = `\`CopilotA2UIRecovery\` no longer exposes \`lifecycle\`, \`retryRevealed\`, \`debugExposure\`, \`label\`, \`phase\`, \`failureDiagnostics\` or \`retryDiagnostics\`. Read the lifecycle from the activity content with \`readA2UILifecycleContent\`. See ${GUIDE}`;

const PLACEHOLDER_NOTE = `The Open Generative UI placeholder element (\`${OGUI_PLACEHOLDER_TEST_ID}\`) was removed in 2.0. While the agent generates, the renderer shows \`open-generative-ui-progress-overlay\` with \`open-generative-ui-spinner\` in it. See ${GUIDE}`;

/** The statement a node is in: the ancestor whose parent holds statements. */
function enclosingStatement(node: Node) {
  let current: Node | null = node;
  while (current) {
    const parent: Node | null = current.parent();
    if (parent === null || STATEMENT_PARENTS.has(parent.kind())) return current;
    current = parent;
  }
  return node;
}

/** Local names imported from `sources` for each of `names`. */
function importedLocals(
  rootNode: Node,
  sources: Set<string>,
  names: readonly string[],
) {
  const locals = new Map<string, string>();
  const statements = rootNode.findAll({ rule: { kind: "import_statement" } });
  for (const statement of statements) {
    const sourceNode = statement.field("source");
    if (!sourceNode || !sources.has(sourceNode.text().slice(1, -1))) continue;
    const specifiers = statement.findAll({
      rule: { kind: "import_specifier" },
    });
    for (const specifier of specifiers) {
      const name = specifier.field("name")?.text();
      if (name === undefined || !names.includes(name)) continue;
      locals.set(specifier.field("alias")?.text() ?? name, name);
    }
  }
  return locals;
}

/**
 * Migrates the generative UI APIs that changed in 2.0:
 *
 * - `filterCatalog(…)` from `@copilotkit/a2ui-renderer`, which 2.0 removed,
 *   gets a TODO that names `standardUI.omit` and `createGenerativeUI`;
 * - uses of the Vue and Angular Open Generative UI schemas as zod schemas
 *   (`.parse`, `.safeParse`, other zod members, zod composition) get a TODO
 *   that names the Standard Schema call;
 * - reads of the removed `CopilotA2UIRecovery` members, and the removed Open
 *   Generative UI placeholder test id, get a TODO.
 *
 * Returns `null` when the file does not change.
 */
export function migrateGenerativeUI(rootNode: Node): string | null {
  const source = rootNode.text();
  const edits: Edit[] = [];
  /** TODO lines by the start index of the statement they go above. */
  const todos = new Map<number, { indent: string; lines: Set<string> }>();
  const addTodo = (node: Node, note: string) => {
    const statement = enclosingStatement(node);
    const start = statement.range().start;
    const line = `// ${TODO} ${note}`;
    if (source.includes(line)) return;
    const entry = todos.get(start.index) ?? {
      indent: " ".repeat(start.column),
      lines: new Set<string>(),
    };
    entry.lines.add(line);
    todos.set(start.index, entry);
  };

  const filterCatalogs = importedLocals(rootNode, FILTER_CATALOG_SOURCES, [
    "filterCatalog",
  ]);
  for (const local of filterCatalogs.keys()) {
    const calls = rootNode.findAll({
      rule: {
        kind: "call_expression",
        has: { field: "function", regex: `^${local}$` },
      },
    });
    for (const call of calls) addTodo(call, FILTER_CATALOG_NOTE);
  }

  const schemas = importedLocals(
    rootNode,
    OGUI_SCHEMA_SOURCES,
    OGUI_SCHEMA_NAMES,
  );
  for (const [local, name] of schemas) {
    const references = rootNode.findAll({
      rule: {
        kind: "identifier",
        regex: `^${local}$`,
        not: { inside: { kind: "import_statement" } },
      },
    });
    for (const reference of references) {
      const parent = reference.parent();
      const isObject =
        parent?.kind() === "member_expression" &&
        parent.field("object")?.text() === local;
      if (isObject) {
        const member = parent.field("property")?.text() ?? "";
        addTodo(
          reference,
          PARSE_METHODS.has(member)
            ? parseNote(name, member)
            : memberNote(name, member),
        );
        continue;
      }
      const composer = reference
        .ancestors()
        .find((ancestor) => ancestor.kind() === "call_expression");
      const callee = composer?.field("function")?.text() ?? "";
      if (ZOD_COMPOSITION.test(callee))
        addTodo(reference, compositionNote(name));
    }
  }

  const recovery = importedLocals(rootNode, new Set(["@copilotkit/angular"]), [
    "CopilotA2UIRecovery",
  ]);
  if (recovery.size > 0 && RECOVERY_MEMBERS.test(source)) {
    const imports = rootNode.findAll({ rule: { kind: "import_statement" } });
    const statement = imports.find((candidate) =>
      candidate.text().includes("CopilotA2UIRecovery"),
    );
    if (statement) addTodo(statement, RECOVERY_NOTE);
  }

  if (source.includes(OGUI_PLACEHOLDER_TEST_ID)) {
    const strings = rootNode.findAll({
      rule: {
        any: [{ kind: "string_fragment" }, { kind: "template_string" }],
        regex: OGUI_PLACEHOLDER_TEST_ID,
      },
    });
    for (const string of strings) addTodo(string, PLACEHOLDER_NOTE);
  }

  for (const [startPos, { indent, lines }] of todos) {
    edits.push({
      startPos,
      endPos: startPos,
      insertedText: [...lines].map((line) => `${line}\n${indent}`).join(""),
    });
  }

  if (edits.length === 0) return null;
  return rootNode.commitEdits(edits);
}
