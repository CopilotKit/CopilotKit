import type { Edit, SgNode } from "codemod:ast-grep";
import type TS from "codemod:ast-grep/langs/typescript";
import type TSX from "codemod:ast-grep/langs/tsx";
import { byteIndex, charIndex } from "./offsets.ts";

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
    createNodeFetchHandler: "createCopilotKitNodeHandler",
  },
};

/**
 * Runtime exports that 2.0 renamed to include "Kit". The old names are
 * deprecated aliases. This rename runs after every other step, because those
 * steps find the runtime by its 1.x name, `CopilotRuntime`.
 */
const KIT_NAMES: Record<string, Record<string, string>> = {
  "@copilotkit/runtime": {
    createCopilotRuntimeHandler: "createCopilotKitRuntimeHandler",
    ...Object.fromEntries(
      [
        "Runtime",
        "SseRuntime",
        "IntelligenceRuntime",
        "RuntimeConstructor",
        "RuntimeOptions",
        "RuntimeLike",
        "SseRuntimeOptions",
        "SseRuntimeLike",
        "IntelligenceRuntimeOptions",
        "IntelligenceRuntimeLike",
        "RuntimeMemoryConfig",
        "RuntimeUser",
        "RuntimeLearningConfig",
        "RuntimeLearningContext",
        "RuntimeLogger",
        "RuntimeHandlerOptions",
        "RuntimeFetchHandler",
        "RuntimeFetchHandlerWithChannels",
        "RuntimeHooks",
        "CorsConfig",
      ].map((name) => [`Copilot${name}`, `CopilotKit${name}`]),
    ),
  },
  "@copilotkit/runtime/node": {
    createCopilotNodeHandler: "createCopilotKitNodeHandler",
    createCopilotNodeListener: "createCopilotKitNodeListener",
    NodeCopilotListener: "NodeCopilotKitListener",
    NodeCopilotListenerWithChannels: "NodeCopilotKitListenerWithChannels",
  },
};

/** `@copilotkit/a2ui-renderer` is gone in 2.0: generative UI replaces it. */
const A2UI_GUIDE =
  "https://docs.copilotkit.ai/generative-ui/components/from-a2ui";
const A2UI_CATALOG_NOTE = `Declare the components with \`createGenerativeUI({ id, components })\` from "@copilotkit/react-core/generative-ui": one entry per component with \`component\`, \`description\` and \`props\`. See ${A2UI_GUIDE}#convert-a-custom-catalog`;
const A2UI_STORE_NOTE =
  'Generative UI has no A2UI store. Declare app state as `state` on `createGenerativeUI`, set it with `useGenerativeUIState(ui, key, value)` from "@copilotkit/react-core/generative-ui", and components read it as bound props. See https://docs.copilotkit.ai/generative-ui/components/state-and-actions';

/**
 * Exports that were deprecated in 1.x and removed in 2.0 without a same-API
 * replacement. The import gets a TODO comment that names the 2.0 way.
 */
const REMOVED: Record<string, Record<string, string>> = {
  "@copilotkit/runtime": {
    CopilotKitRequestHandler:
      "Use `CopilotKitRuntimeFetchHandler`. It takes the `Request` directly, not `{ request }`.",
  },
  "@copilotkit/a2ui-renderer": {
    useA2UIStore: A2UI_STORE_NOTE,
    useA2UIStoreSelector: A2UI_STORE_NOTE,
    createA2UICatalog: A2UI_CATALOG_NOTE,
    extractA2UISchema: `Use \`exportA2UICatalog(ui)\` from "@copilotkit/react-core/generative-ui", with a UI from \`createGenerativeUI\`. See ${A2UI_GUIDE}`,
    A2UIComponentDefinition: A2UI_CATALOG_NOTE,
    A2UIComponentMap: A2UI_CATALOG_NOTE,
    A2UIComponentProps: A2UI_CATALOG_NOTE,
    ComponentLoader: A2UI_CATALOG_NOTE,
    ComponentRegistration: A2UI_CATALOG_NOTE,
  },
  "@copilotkit/shared": {
    ImageData:
      "Use `ImageInputPart`, and send images as `content` parts. See https://docs.copilotkit.ai/migrate/removed-apis-2.0",
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
};

/**
 * Lifecycle methods that a 2.0 class no longer has, keyed by the class's
 * export. In a subclass, `super.<method>()` is deleted and `override` is
 * dropped from the method: the base class now does that work by itself.
 */
const REMOVED_SUPER_METHODS: Record<
  string,
  { source: string; methods: string[] }
> = {
  // 2.0 measures the text box from an `afterRenderEffect`.
  CopilotChatTextarea: {
    source: "@copilotkit/angular",
    methods: ["ngAfterViewInit"],
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
  /** Local names of the classes in REMOVED_SUPER_METHODS. */
  const baseClasses = new Map<string, string>();

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
      const baseClass = own(REMOVED_SUPER_METHODS, name);
      if (baseClass?.source === from) baseClasses.set(alias ?? name, name);

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

  edits.push(...referenceEdits(rootNode, renames));

  if (jsx && components.size > 0)
    edits.push(...propEdits(rootNode, components, source));
  if (baseClasses.size > 0)
    edits.push(...superMethodEdits(rootNode, baseClasses, source));

  if (edits.length === 0) return null;
  return rootNode.commitEdits(edits);
}

/**
 * Renames the runtime exports in KIT_NAMES to their "Kit" names: the import
 * and every reference in the file. Runs last, before the imports merge.
 * Returns `null` when the file does not change.
 */
export function migrateKitNames(rootNode: Node): string | null {
  const source = rootNode.text();
  if (!source.includes("@copilotkit/runtime")) return null;
  const edits: Edit[] = [];
  const renames = new Map<string, string>();
  for (const statement of rootNode.findAll({
    rule: {
      any: [
        { kind: "import_statement" },
        { kind: "export_statement", has: { field: "source", kind: "string" } },
      ],
    },
  })) {
    const sourceNode = statement.field("source");
    if (!sourceNode) continue;
    const table = own(KIT_NAMES, sourceNode.text().slice(1, -1));
    if (table === undefined) continue;
    const specifiers = statement.findAll({
      rule: {
        any: [{ kind: "import_specifier" }, { kind: "export_specifier" }],
      },
    });
    const imported = new Set(
      specifiers
        .filter((specifier) => !specifier.field("alias"))
        .map((specifier) => specifier.field("name")?.text()),
    );
    for (const specifier of specifiers) {
      const nameNode = specifier.field("name");
      if (!nameNode) continue;
      const name = nameNode.text();
      const target = own(table, name);
      if (target === undefined) continue;
      const alias = specifier.field("alias")?.text();
      edits.push(
        alias === undefined && imported.has(target)
          ? deleteSpecifier(specifier, source)
          : nameNode.replace(target),
      );
      if (alias === undefined) renames.set(name, target);
    }
  }
  edits.push(...referenceEdits(rootNode, renames));
  if (edits.length === 0) return null;
  return rootNode.commitEdits(edits);
}

/** Renames every reference to a renamed import, outside import and export specifiers. */
function referenceEdits(rootNode: Node, renames: Map<string, string>): Edit[] {
  const edits: Edit[] = [];
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
  return edits;
}

/** Deletes a specifier with its comma, and its line when it is alone on one. */
function deleteSpecifier(specifier: Node, source: string): Edit {
  let start = charIndex(source, specifier.range().start.index);
  let end = charIndex(source, specifier.range().end.index);
  const comma = /^\s*,[ \t]*\n?/.exec(source.slice(end));
  if (comma) {
    end += comma[0].length;
    let lineStart = start;
    while (lineStart > 0 && /[ \t]/.test(source[lineStart - 1]!)) lineStart--;
    if (source[lineStart - 1] === "\n") start = lineStart;
  } else {
    const before = /,\s*$/.exec(source.slice(0, start));
    if (before) start -= before[0].length;
  }
  return {
    startPos: byteIndex(source, start),
    endPos: byteIndex(source, end),
    insertedText: "",
  };
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
        let startChar = charIndex(source, start);
        while (startChar > 0 && /\s/.test(source[startChar - 1]!)) startChar--;
        edits.push({
          startPos: byteIndex(source, startChar),
          endPos: attribute.range().end.index,
          insertedText: "",
        });
        continue;
      }
      const comment = `/* ${TODO} ${message} */`;
      if (
        source.slice(0, charIndex(source, start)).trimEnd().endsWith(comment)
      ) {
        continue;
      }
      edits.push({
        startPos: start,
        endPos: start,
        insertedText: `${comment} `,
      });
    }
  }
  return edits;
}

/** Deletes a node with the whitespace before it on its line, and its line break. */
function deleteLine(node: Node, source: string): Edit {
  let start = charIndex(source, node.range().start.index);
  let end = charIndex(source, node.range().end.index);
  while (start > 0 && /[ \t]/.test(source[start - 1]!)) start--;
  if (source[end] === "\n") end++;
  return {
    startPos: byteIndex(source, start),
    endPos: byteIndex(source, end),
    insertedText: "",
  };
}

/**
 * In classes that extend a class in REMOVED_SUPER_METHODS, deletes the calls
 * of the removed methods on `super` and drops `override` from their
 * overrides.
 */
function superMethodEdits(
  rootNode: Node,
  baseClasses: Map<string, string>,
  source: string,
): Edit[] {
  const edits: Edit[] = [];
  const classes = rootNode.findAll({
    rule: {
      any: [{ kind: "class_declaration" }, { kind: "class" }],
      has: { kind: "class_heritage" },
    },
  });
  for (const declaration of classes) {
    const extendsClause = declaration.find({
      rule: { kind: "extends_clause" },
    });
    const base = extendsClause?.field("value")?.text();
    const exported = base === undefined ? undefined : baseClasses.get(base);
    if (exported === undefined) continue;
    const methods = REMOVED_SUPER_METHODS[exported]!.methods;
    for (const method of methods) {
      const calls = declaration.findAll({
        rule: {
          kind: "expression_statement",
          regex: `^super\\s*\\.\\s*${method}\\s*\\(\\s*\\)\\s*;?$`,
        },
      });
      for (const call of calls) edits.push(deleteLine(call, source));

      const overrides = declaration.findAll({
        rule: { kind: "method_definition" },
      });
      for (const definition of overrides) {
        if (definition.field("name")?.text() !== method) continue;
        const modifier = definition
          .children()
          .find((child) => child.kind() === "override_modifier");
        if (!modifier) continue;
        let end = charIndex(source, modifier.range().end.index);
        while (/[ \t]/.test(source[end] ?? "")) end++;
        edits.push({
          startPos: modifier.range().start.index,
          endPos: byteIndex(source, end),
          insertedText: "",
        });
      }
    }
  }
  return edits;
}
