import type { Edit, SgNode } from "codemod:ast-grep";
import type TS from "codemod:ast-grep/langs/typescript";
import type TSX from "codemod:ast-grep/langs/tsx";

type Node = SgNode<TS | TSX>;

const TODO = "TODO(copilotkit-2.0):";

/**
 * Exports that were deprecated in 1.x and removed in 2.0, and the 2.0 export
 * with the same API. The import and every reference in the file are renamed.
 */
const RENAMED: Record<string, Record<string, string>> = {
  "@copilotkit/runtime": {
    BasicAgent: "BuiltInAgent",
    BasicAgentConfiguration: "BuiltInAgentClassicConfig",
  },
  "@copilotkit/runtime/node": {
    createNodeFetchHandler: "createCopilotNodeHandler",
  },
  "@copilotkit/a2ui-renderer": {
    useA2UIStore: "useA2UIContext",
  },
};

const A2UI_CATALOG_NOTE =
  "v0.9 components come from the catalog. See https://docs.copilotkit.ai/generative-ui/a2ui";

/**
 * Exports that were deprecated in 1.x and removed in 2.0 without a same-API
 * replacement. The import gets a TODO comment that names the 2.0 way.
 */
const REMOVED: Record<string, Record<string, string>> = {
  "@copilotkit/runtime": {
    CopilotKitRequestHandler:
      "Use `CopilotRuntimeFetchHandler`. It takes the `Request` directly, not `{ request }`.",
  },
  "@copilotkit/a2ui-renderer": {
    useA2UIStoreSelector:
      "Call `useA2UIContext()` and read the value from its result.",
    createA2UICatalog:
      "Use `createCatalog(definitions, renderers)`. Put each component's `props` and `description` in `definitions`, and its `render` in `renderers`.",
    extractA2UISchema:
      "Use `extractSchema(definitions)` with the definitions you pass to `createCatalog`.",
    A2UIComponentDefinition:
      "Use `createCatalog(definitions, renderers)`, which takes definitions and renderers separately.",
    A2UIComponentMap:
      "Use `createCatalog(definitions, renderers)`, which takes definitions and renderers separately.",
    A2UIComponentProps: A2UI_CATALOG_NOTE,
    ComponentLoader: A2UI_CATALOG_NOTE,
    ComponentRegistration: A2UI_CATALOG_NOTE,
  },
  "@copilotkit/shared": {
    ImageData:
      "Use `InputContentSource`, and send images as `content` parts. See https://docs.copilotkit.ai/migration-guides/migrate-attachments",
  },
};

/** Props that 2.0 removed from a component, keyed by the component's export. */
const REMOVED_PROPS: Record<
  string,
  { source: string; props: Record<string, string | null> }
> = {
  CopilotKitProvider: {
    source: "@copilotkit/react-core",
    // `null`: the prop did nothing in 1.x, so it is deleted.
    props: { showDevConsole: null },
  },
  CopilotChatView: {
    source: "@copilotkit/react-core",
    props: {
      disclaimer:
        "`disclaimer` was removed from `CopilotChatView`. Pass it to the input slot: `input={{ disclaimer: ... }}`.",
    },
  },
  A2UIRenderer: {
    source: "@copilotkit/a2ui-renderer",
    props: { registry: null },
  },
};

function own<T>(table: Record<string, T> | undefined, key: string) {
  return table && Object.prototype.hasOwnProperty.call(table, key)
    ? table[key]
    : undefined;
}

/**
 * Migrates the 1.x deprecations that 2.0 removed. Runs after the `/v2` paths
 * are moved to the package roots, so it only needs to know the 2.0 paths.
 * Returns `null` when the file does not change.
 */
export function migrateDeprecatedApis(
  rootNode: Node,
  jsx: boolean,
): string | null {
  const source = rootNode.text();
  if (!source.includes("@copilotkit/")) return null;
  const edits: Edit[] = [];
  /** Local names that every reference in the file is renamed from and to. */
  const renames = new Map<string, string>();
  /** Local names of the components in REMOVED_PROPS. */
  const components = new Map<string, string>();

  const statements = rootNode.findAll({
    rule: {
      any: [
        { kind: "import_statement" },
        { kind: "export_statement", has: { field: "source", kind: "string" } },
      ],
    },
  });
  for (const statement of statements) {
    const sourceNode = statement.field("source");
    if (!sourceNode) continue;
    const from = sourceNode.text().slice(1, -1);
    const renamed = own(RENAMED, from);
    const removed = own(REMOVED, from);
    const specifiers = statement.findAll({
      rule: {
        any: [{ kind: "import_specifier" }, { kind: "export_specifier" }],
      },
    });

    /** Names the statement already imports without an alias. */
    const imported = new Set(
      specifiers
        .filter((specifier) => !specifier.field("alias"))
        .map((specifier) => specifier.field("name")?.text()),
    );
    const todos: string[] = [];
    for (const specifier of specifiers) {
      const nameNode = specifier.field("name");
      if (!nameNode) continue;
      const name = nameNode.text();
      const alias = specifier.field("alias")?.text();

      const component = own(REMOVED_PROPS, name);
      if (component?.source === from) components.set(alias ?? name, name);

      const target = own(renamed, name);
      if (target !== undefined) {
        // `{ BasicAgent, BuiltInAgent }` keeps only `BuiltInAgent`.
        edits.push(
          alias === undefined && imported.has(target)
            ? deleteSpecifier(specifier, source)
            : nameNode.replace(target),
        );
        if (alias === undefined) renames.set(name, target);
        continue;
      }
      const message = own(removed, name);
      if (message !== undefined) {
        todos.push(`// ${TODO} \`${name}\` was removed in 2.0. ${message}`);
      }
    }
    const comments = todos.filter((line) => !source.includes(line));
    if (comments.length > 0) {
      const start = statement.range().start.index;
      edits.push({
        startPos: start,
        endPos: start,
        insertedText: `${comments.join("\n")}\n`,
      });
    }
  }

  for (const [from, to] of renames) {
    const references = rootNode.findAll({
      rule: {
        any: [{ kind: "identifier" }, { kind: "type_identifier" }],
        regex: `^${from}$`,
        not: {
          inside: {
            any: [{ kind: "import_specifier" }, { kind: "export_specifier" }],
          },
        },
      },
    });
    for (const reference of references) edits.push(reference.replace(to));
  }

  if (jsx && components.size > 0)
    edits.push(...propEdits(rootNode, components, source));

  if (edits.length === 0) return null;
  return rootNode.commitEdits(edits);
}

/** Deletes a specifier with its comma, and its line when it is alone on one. */
function deleteSpecifier(specifier: Node, source: string): Edit {
  let startPos = specifier.range().start.index;
  let endPos = specifier.range().end.index;
  const comma = /^\s*,[ \t]*\n?/.exec(source.slice(endPos));
  if (comma) {
    endPos += comma[0].length;
    let lineStart = startPos;
    while (lineStart > 0 && /[ \t]/.test(source[lineStart - 1]!)) lineStart--;
    if (source[lineStart - 1] === "\n") startPos = lineStart;
  } else {
    const before = /,\s*$/.exec(source.slice(0, startPos));
    if (before) startPos -= before[0].length;
  }
  return { startPos, endPos, insertedText: "" };
}

function propEdits(
  rootNode: Node,
  components: Map<string, string>,
  source: string,
): Edit[] {
  const edits: Edit[] = [];
  const elements = (rootNode as SgNode<TSX>).findAll({
    rule: {
      any: [
        { kind: "jsx_opening_element" },
        { kind: "jsx_self_closing_element" },
      ],
    },
  });
  for (const element of elements) {
    const local = element.field("name")?.text();
    const exported = local === undefined ? undefined : components.get(local);
    if (exported === undefined) continue;
    const props = REMOVED_PROPS[exported]!.props;
    for (const attribute of element.children()) {
      if (attribute.kind() !== "jsx_attribute") continue;
      const prop = attribute.child(0)?.text();
      if (prop === undefined) continue;
      const message = own(props, prop);
      if (message === undefined) continue;
      const start = attribute.range().start.index;
      if (message === null) {
        // Delete the attribute with the whitespace before it.
        let startPos = start;
        while (startPos > 0 && /\s/.test(source[startPos - 1]!)) startPos--;
        edits.push({
          startPos,
          endPos: attribute.range().end.index,
          insertedText: "",
        });
        continue;
      }
      const comment = `/* ${TODO} ${message} */`;
      if (source.slice(0, start).trimEnd().endsWith(comment)) continue;
      edits.push({
        startPos: start,
        endPos: start,
        insertedText: `${comment} `,
      });
    }
  }
  return edits;
}
