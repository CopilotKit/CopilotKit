import type { Edit, SgNode } from "codemod:ast-grep";
import type TSX from "codemod:ast-grep/langs/tsx";
import { argumentNodes, stringLiteral } from "./ast-helpers.ts";
import type { Node } from "./ast-helpers.ts";
import { byteIndex, charIndex } from "./offsets.ts";

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
 * Runtime exports that 2.0 renamed to include "Kit". The package roots export
 * only the new names (the deprecated `/v2` subpaths keep the old names as
 * aliases), so every use of an old name is renamed. This rename runs after
 * every other step, because those steps find the runtime by its 1.x name,
 * `CopilotRuntime`.
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
export function migrateDeprecatedApis(rootNode: Node, jsx: boolean) {
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

/** Nodes between `import()` or `require()` and what reads the module. */
const MODULE_WRAPPERS = ["await_expression", "parenthesized_expression"];

/**
 * Renames the runtime exports in KIT_NAMES to their "Kit" names everywhere
 * the file uses them:
 *
 * - a named import, and every reference to it;
 * - a re-export, which keeps the name the file exports:
 *   `export { CopilotRuntime } from "@copilotkit/runtime"` becomes
 *   `export { CopilotKitRuntime as CopilotRuntime } from "@copilotkit/runtime"`;
 * - a member of the whole module: `runtime.CopilotRuntime` after
 *   `import * as runtime from "@copilotkit/runtime"`,
 *   `import runtime = require("@copilotkit/runtime")` or
 *   `const runtime = require("@copilotkit/runtime")`;
 * - `import()` and `require()`: a destructured name, the same way as a named
 *   import, and a member read off the call
 *   (`require("@copilotkit/runtime").CopilotRuntime`).
 *
 * Runs last, before the imports merge. Returns `null` when the file does not
 * change.
 */
export function migrateKitNames(rootNode: Node) {
  const source = rootNode.text();
  if (!source.includes("@copilotkit/runtime")) return null;
  const edits: Edit[] = [];
  const renames = new Map<string, string>();
  /** Names bound to a whole module in KIT_NAMES, with that module's renames. */
  const modules = new Map<string, Record<string, string>>();

  const statements = rootNode.findAll({
    rule: {
      any: [
        { kind: "import_statement" },
        { kind: "export_statement", has: { field: "source", kind: "string" } },
      ],
    },
  });
  for (const statement of statements) {
    // `import runtime = require("…")` has its source in the require clause.
    const requireClause = statement.find({
      rule: { kind: "import_require_clause" },
    });
    const sourceNode =
      statement.field("source") ?? requireClause?.field("source");
    if (!sourceNode) continue;
    const table = own(KIT_NAMES, sourceNode.text().slice(1, -1));
    if (table === undefined) continue;
    const wholeModule =
      statement.find({ rule: { kind: "namespace_import" } }) ?? requireClause;
    const binding = wholeModule?.find({ rule: { kind: "identifier" } });
    if (binding) modules.set(binding.text(), table);

    const specifiers = statement.findAll({
      rule: {
        any: [{ kind: "import_specifier" }, { kind: "export_specifier" }],
      },
    });
    if (statement.kind() === "export_statement") {
      edits.push(...exportEdits(specifiers, (name) => own(table, name)));
    } else {
      const bindings = specifiers.flatMap((specifier) => {
        const name = specifier.field("name");
        const aliased = Boolean(specifier.field("alias"));
        return name ? [{ node: specifier, name, aliased }] : [];
      });
      edits.push(...bindingEdits(bindings, table, renames, source));
    }
  }

  const calls = rootNode.findAll({
    rule: {
      kind: "call_expression",
      has: {
        field: "function",
        any: [{ kind: "import" }, { kind: "identifier", regex: "^require$" }],
      },
    },
  });
  for (const call of calls) {
    const [argument, ...rest] = argumentNodes(call);
    const from =
      argument && rest.length === 0 ? stringLiteral(argument) : undefined;
    const table = from === undefined ? undefined : own(KIT_NAMES, from);
    if (table === undefined) continue;
    // What the module goes into, past `await` and parentheses.
    let use = call.parent();
    while (use && MODULE_WRAPPERS.includes(use.kind())) use = use.parent();
    if (use?.kind() === "member_expression") {
      // `require("@copilotkit/runtime").CopilotRuntime`
      const property = use.field("property");
      const target = property ? own(table, property.text()) : undefined;
      if (property && target !== undefined)
        edits.push(property.replace(target));
      continue;
    }
    if (use?.kind() !== "variable_declarator") continue;
    const name = use.field("name");
    if (name?.kind() === "identifier") modules.set(name.text(), table);
    if (name?.kind() === "object_pattern") {
      edits.push(
        ...bindingEdits(patternBindings(name), table, renames, source),
      );
    }
  }

  edits.push(...memberEdits(rootNode, modules));
  edits.push(...referenceEdits(rootNode, renames));
  if (edits.length === 0) return null;
  return rootNode.commitEdits(edits);
}

/**
 * A name a file takes from a module: an import specifier, or a key of a
 * destructured `import()` or `require()`.
 */
interface Binding {
  /** The specifier or pattern entry. */
  node: Node;
  /** The node that names the module's export. */
  name: Node;
  /** Whether the file binds the export under another name. */
  aliased: boolean;
}

/**
 * Renames the names a file takes from a module in KIT_NAMES. A name taken
 * under its own name is added to `renames`, so every reference to it is
 * renamed too. When the file also takes the "Kit" name, the old one is
 * deleted.
 */
function bindingEdits(
  bindings: Binding[],
  table: Record<string, string>,
  renames: Map<string, string>,
  source: string,
) {
  const unaliased = new Set(
    bindings.filter(({ aliased }) => !aliased).map(({ name }) => name.text()),
  );
  const edits: Edit[] = [];
  for (const { node, name, aliased } of bindings) {
    const target = own(table, name.text());
    if (target === undefined) continue;
    // `{ CopilotRuntime, CopilotKitRuntime }` keeps only `CopilotKitRuntime`.
    const isDuplicate = !aliased && unaliased.has(target);
    edits.push(
      isDuplicate ? deleteSpecifier(node, source) : name.replace(target),
    );
    if (!aliased) renames.set(name.text(), target);
  }
  return edits;
}

/** The names an object pattern takes: `{ A }` binds `A`, `{ A: B }` binds `B`. */
function patternBindings(pattern: Node) {
  const bindings: Binding[] = [];
  const properties = pattern.children();
  for (const property of properties) {
    if (property.kind() === "shorthand_property_identifier_pattern") {
      bindings.push({ node: property, name: property, aliased: false });
    }
    const key = property.kind() === "pair_pattern" && property.field("key");
    if (key) bindings.push({ node: property, name: key, aliased: true });
  }
  return bindings;
}

/**
 * Renames the names export specifiers take, and keeps the names the file
 * exports: `export { CopilotRuntime }` becomes
 * `export { CopilotKitRuntime as CopilotRuntime }`. `renamed` gives the new
 * name, or `undefined` to keep the specifier.
 */
function exportEdits(
  specifiers: Node[],
  renamed: (name: string) => string | undefined,
) {
  const edits: Edit[] = [];
  for (const specifier of specifiers) {
    const name = specifier.field("name");
    const target = name ? renamed(name.text()) : undefined;
    if (!name || target === undefined) continue;
    const isAliased = Boolean(specifier.field("alias"));
    edits.push(
      name.replace(isAliased ? target : `${target} as ${name.text()}`),
    );
  }
  return edits;
}

/**
 * Renames the members of a whole module in KIT_NAMES: `runtime.CopilotRuntime`
 * in values and `runtime.CopilotRuntimeOptions` in types, for each name in
 * `modules`.
 */
function memberEdits(
  rootNode: Node,
  modules: Map<string, Record<string, string>>,
) {
  if (modules.size === 0) return [];
  const edits: Edit[] = [];
  const members = rootNode.findAll({
    rule: {
      any: [{ kind: "member_expression" }, { kind: "nested_type_identifier" }],
    },
  });
  for (const member of members) {
    const isType = member.kind() === "nested_type_identifier";
    const object = member.field(isType ? "module" : "object");
    const property = member.field(isType ? "name" : "property");
    const table =
      object?.kind() === "identifier" ? modules.get(object.text()) : undefined;
    const target = table && property ? own(table, property.text()) : undefined;
    if (property && target !== undefined) edits.push(property.replace(target));
  }
  return edits;
}

/**
 * Renames every reference to a renamed import. An object shorthand keeps its
 * key, and `export { … }` keeps the name it exports: `{ CopilotRuntime }`
 * becomes `{ CopilotRuntime: CopilotKitRuntime }`, and
 * `export { CopilotRuntime }` becomes
 * `export { CopilotKitRuntime as CopilotRuntime }`.
 */
function referenceEdits(rootNode: Node, renames: Map<string, string>) {
  if (renames.size === 0) return [];
  const edits: Edit[] = [];
  for (const [from, to] of renames) {
    const references = rootNode.findAll({
      rule: {
        any: [
          { kind: "identifier" },
          { kind: "shorthand_property_identifier" },
          // In `other.CopilotRuntimeOptions`, the name is a member of `other`.
          {
            kind: "type_identifier",
            not: { inside: { kind: "nested_type_identifier" } },
          },
        ],
        regex: `^${from}$`,
        not: {
          inside: {
            any: [{ kind: "import_specifier" }, { kind: "export_specifier" }],
          },
        },
      },
    });
    for (const reference of references) {
      const isShorthand = reference.kind() === "shorthand_property_identifier";
      edits.push(reference.replace(isShorthand ? `${from}: ${to}` : to));
    }
  }
  // `export { … }` without `from` exports this file's names.
  const localExports = rootNode.findAll({
    rule: {
      kind: "export_specifier",
      not: {
        inside: {
          kind: "export_statement",
          has: { field: "source", kind: "string" },
          stopBy: "end",
        },
      },
    },
  });
  edits.push(...exportEdits(localExports, (name) => renames.get(name)));
  return edits;
}

/**
 * Deletes a specifier or a destructured key with its comma, and its line when
 * it is alone on one.
 */
function deleteSpecifier(specifier: Node, source: string) {
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
) {
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
function deleteLine(node: Node, source: string) {
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
) {
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
