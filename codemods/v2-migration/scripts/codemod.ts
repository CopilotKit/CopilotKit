import { parse } from "codemod:ast-grep";
import { migrateRuntimeAdapters } from "./runtime-adapters.ts";
import type { Codemod, Edit, SgNode } from "codemod:ast-grep";
import type TS from "codemod:ast-grep/langs/typescript";
import type TSX from "codemod:ast-grep/langs/tsx";
import { V1_API } from "./v1-api.ts";
import type { V1Export } from "./v1-api.ts";

type Lang = TS | TSX;
type Node = SgNode<Lang>;

/** Every comment the codemod adds starts with this, so a user can grep for them. */
export const TODO = "TODO(copilotkit-2.0):";
const GUIDE = "https://docs.copilotkit.ai/migrate/v2";

/** Import paths that only moved: the `/v2` subpaths are the package roots in 2.0. */
const PATHS: Record<string, string> = {
  "@copilotkit/react-core/v2": "@copilotkit/react-core",
  "@copilotkit/react-core/v2/headless": "@copilotkit/react-core/headless",
  "@copilotkit/react-core/v2/context": "@copilotkit/react-core/context",
  "@copilotkit/react-core/v2/generative-ui":
    "@copilotkit/react-core/generative-ui",
  "@copilotkit/runtime/v2": "@copilotkit/runtime",
  "@copilotkit/runtime/v2/node": "@copilotkit/runtime/node",
};

/**
 * Stylesheets that no longer exist: the 2.0 components add their own styles.
 * Imports of them are deleted. `@copilotkit/react-core/styles.css` shipped in
 * the 2.0 release candidates.
 */
const STYLESHEETS = new Set([
  "@copilotkit/react-core/v2/styles.css",
  "@copilotkit/react-ui/v2/styles.css",
  "@copilotkit/react-ui/styles.css",
  "@copilotkit/react-core/styles.css",
]);

/** Framework adapters were removed, not renamed: calls need manual migration. */
const REMOVED_RUNTIME_PATHS = new Set([
  "@copilotkit/runtime/express",
  "@copilotkit/runtime/hono",
  "@copilotkit/runtime/v2/express",
  "@copilotkit/runtime/v2/hono",
]);
const RUNTIME_ADAPTERS = new Set([
  "createCopilotExpressHandler",
  "createCopilotEndpointExpress",
  "createCopilotEndpointSingleRouteExpress",
  "CopilotExpressRouter",
  "CopilotExpressEndpointParams",
  "createCopilotHonoHandler",
  "createCopilotEndpoint",
  "createCopilotEndpointSingleRoute",
  "CopilotHonoApp",
  "CopilotEndpointCorsConfig",
]);
const ADAPTER_NOTE =
  'Express/Hono adapters were removed in 2.0. Use createCopilotRuntimeHandler from "@copilotkit/runtime" (Request => Response), or createCopilotNodeListener from "@copilotkit/runtime/node". Remove handle(app)/.fetch wrappers, set mode: "single-route" for single endpoints, and set cors explicitly. Router methods and framework CORS options require manual migration. See ' +
  "https://docs.copilotkit.ai/migrate/runtime-2.0";

/**
 * The 2.0 provider is `CopilotKitProvider`. `CopilotKit` was the v1 provider,
 * also re-exported from `/v2`, and it does not exist in 2.0.
 */
const PROVIDER_RENAMES: Record<string, string> = {
  CopilotKit: "CopilotKitProvider",
  CopilotKitProps: "CopilotKitProviderProps",
};
const PROVIDER_SOURCES = [
  "@copilotkit/react-core",
  "@copilotkit/react-core/v2",
];

const LANGGRAPH_EVENTS_NOTE =
  "`@ag-ui/langgraph` does not handle CopilotKit's LangGraph events (`copilotkit_emit_message`, `copilotkit_emit_state`, `copilotkit_emit_tool_call`, `copilotkit_exit` from the Python SDK). Check that your agent does not rely on them.";
const PROPS_CHANGED_NOTE =
  "Its props changed in 2.0. Check each prop against the docs.";

/** Decisions made for 2.0 that the v1 snapshot does not know about. */
const OVERRIDES: Record<string, Record<string, V1Export>> = {
  "@copilotkit/runtime/langgraph": langGraphOverrides(),
  "@copilotkit/runtime": langGraphOverrides(),
  "@copilotkit/react-ui": Object.fromEntries(
    [
      "CopilotChat",
      "CopilotPopup",
      "CopilotSidebar",
      "AssistantMessage",
      "UserMessage",
    ].map((name) => [
      name,
      {
        replacement: {
          name,
          importPath: "@copilotkit/react-core",
          docs: `https://docs.copilotkit.ai/reference/v2/components/${name}`,
          notes: [PROPS_CHANGED_NOTE],
        },
      },
    ]),
  ),
};

function langGraphOverrides(): Record<string, V1Export> {
  const docs = "https://docs.copilotkit.ai/agent-spec/langgraph";
  const move = (name: string, notes: string[]): V1Export => ({
    replacement: { name, importPath: "@ag-ui/langgraph", docs, notes },
  });
  return {
    LangGraphAgent: move("LangGraphAgent", [LANGGRAPH_EVENTS_NOTE]),
    LangGraphHttpAgent: move("LangGraphHttpAgent", [LANGGRAPH_EVENTS_NOTE]),
    CustomEventNames: move("CustomEventNames", [
      "The enum members are named differently in `@ag-ui/langgraph`.",
    ]),
    PredictStateTool: move("PredictStateTool", []),
  };
}

/** Props of the v1 `<CopilotKit>` that the 2.0 provider does not take. */
const V1_ONLY_PROVIDER_PROPS: Record<string, string> = {
  threadId:
    "`threadId` is no longer a provider prop. Pass it to `<CopilotChat threadId>`, or wrap the chat in `<CopilotChatConfigurationProvider threadId>`.",
  guardrails_c: "`guardrails_c` was removed in 2.0.",
  cloudRestrictToTopic: "`cloudRestrictToTopic` was removed in 2.0.",
  authConfig_c: "`authConfig_c` was removed in 2.0.",
  forwardedParameters:
    "`forwardedParameters` was removed in 2.0. Set model parameters on the agent.",
  transcribeAudioUrl:
    "`transcribeAudioUrl` was removed in 2.0. Voice input goes through the runtime's transcription service.",
  textToSpeechUrl: "`textToSpeechUrl` was removed in 2.0.",
};

const MARKDOWN_GUIDE = "https://docs.copilotkit.ai/migrate/markdown-renderer";
const OWN_RENDERER = `pass your own renderer component as \`markdownRenderer\`: ${MARKDOWN_GUIDE}`;

/**
 * Streamdown props that the `markdownRenderer` slot forwarded before 2.0. The
 * built-in renderer takes `className`, `nodeRenderers`, `caret`, `options`,
 * `onLinkClick`, and `onCitationClick` only.
 */
const STREAMDOWN_PROPS: Record<string, string> = Object.fromEntries(
  (
    [
      [
        ["components"],
        `The built-in renderer uses \`nodeRenderers\`, keyed by node type (\`link\`, \`heading\`, \`codeBlock\`, ...) and not by HTML tag: ${MARKDOWN_GUIDE}`,
      ],
      [
        ["remarkPlugins", "rehypePlugins", "remarkRehypeOptions"],
        `The built-in renderer has no remark or rehype plugins. To keep them, pass a \`react-markdown\` component as \`markdownRenderer\`: ${MARKDOWN_GUIDE}`,
      ],
      [
        ["shikiTheme"],
        `The built-in renderer does not highlight code. To keep highlighting, set \`nodeRenderers.codeBlock\`, or ${OWN_RENDERER}`,
      ],
      [
        ["mermaid"],
        `The built-in renderer does not draw mermaid diagrams. To keep them, ${OWN_RENDERER}`,
      ],
      [
        ["controls"],
        `The built-in renderer has no copy or download buttons. Delete this prop, or ${OWN_RENDERER}`,
      ],
      [
        ["isAnimating"],
        "Delete this prop. The chat passes `isStreaming` to the renderer.",
      ],
      [
        ["parseIncompleteMarkdown", "mode"],
        "Delete this prop. The built-in renderer always parses streaming markdown.",
      ],
      [
        ["BlockComponent", "parseMarkdownIntoBlocksFn"],
        "Delete this prop. The built-in renderer has no block API.",
      ],
      [
        [
          "allowElement",
          "allowedElements",
          "disallowedElements",
          "skipHtml",
          "unwrapDisallowed",
          "urlTransform",
          "allowedImagePrefixes",
          "allowedLinkPrefixes",
          "defaultOrigin",
        ],
        `Delete this prop. The built-in renderer escapes raw HTML and allows only safe link and image URLs. To filter more, ${OWN_RENDERER}`,
      ],
    ] as const
  ).flatMap(([props, message]) =>
    props.map((prop) => [
      prop,
      `\`${prop}\` was a Streamdown prop. ${message}`,
    ]),
  ),
);

/** `useKatexStyles` was removed from `@copilotkit/vue` with Streamdown. */
const VUE_SOURCES = ["@copilotkit/vue", "@copilotkit/vue/v2"];

/**
 * `table[key]` for the table's own keys only. A plain lookup would find
 * `Object.prototype` members for strings such as "constructor" or "toString".
 */
function own<T>(table: Record<string, T> | undefined, key: string) {
  return table && Object.prototype.hasOwnProperty.call(table, key)
    ? table[key]
    : undefined;
}

function lookup(source: string, name: string): V1Export | undefined {
  return own(own(OVERRIDES, source), name) ?? own(own(V1_API, source), name);
}

/** The text of a string literal without its quotes. */
function unquote(node: Node | SgNode<TSX>) {
  return node.text().slice(1, -1);
}

function requote(node: Node, value: string) {
  const quote = node.text()[0];
  return `${quote}${value}${quote}`;
}

interface Specifier {
  /** The imported (or re-exported) name. */
  name: string;
  /** The specifier as written, with its alias and inline `type`. */
  text: string;
}

function specifiersOf(statement: Node): Specifier[] | null {
  const list =
    statement.find({ rule: { kind: "named_imports" } }) ??
    statement.find({ rule: { kind: "export_clause" } });
  // Default and namespace imports name no single export.
  const clause = statement.find({ rule: { kind: "import_clause" } });
  if (
    clause &&
    clause.children().some((child) => child.kind() !== "named_imports")
  ) {
    return null;
  }
  if (!list) return [];
  return list
    .children()
    .filter((child) =>
      ["import_specifier", "export_specifier"].includes(child.kind()),
    )
    .map((child) => ({
      name: child.field("name")?.text() ?? child.text(),
      text: child.text(),
    }));
}

/** The statement text up to its opening brace: `import type `, `export `, ... */
function statementHead(statement: Node) {
  const text = statement.text();
  const isType = /^(import|export)\s+type\s*\{/.test(text);
  const keyword = text.startsWith("export") ? "export" : "import";
  return isType ? `${keyword} type` : keyword;
}

function renderStatement(
  head: string,
  specifiers: string[],
  source: string,
  quote: string,
  multiline: boolean,
) {
  const unique = [...new Set(specifiers)];
  const list = multiline
    ? `{\n${unique.map((text) => `  ${text},`).join("\n")}\n}`
    : `{ ${unique.join(", ")} }`;
  return `${head} ${list} from ${quote}${source}${quote};`;
}

function todoLines(name: string, entry: V1Export | undefined): string[] {
  if (!entry) return [];
  const { replacement } = entry;
  if (!replacement) {
    const docs = entry.docs ?? GUIDE;
    return [
      `\`${name}\` was removed in 2.0 and has no direct replacement. See ${docs}`,
      ...(entry.notes ?? []).map((note) => `\`${name}\`: ${note}`),
    ];
  }
  if (replacement.name !== name) {
    return [
      `\`${name}\` was removed in 2.0. Use \`${replacement.name}\` from "${replacement.importPath}" instead. Its API is different: ${replacement.docs}`,
      ...(replacement.notes ?? []).map((note) => `\`${name}\`: ${note}`),
    ];
  }
  return (replacement.notes ?? []).map(
    (note) => `\`${name}\`: ${note} ${replacement.docs}`,
  );
}

/**
 * Migrates one file:
 *
 * - `/v2` import paths become the package roots;
 * - imports of v1 APIs move to their 2.0 home when it has the same name and
 *   API, and get a TODO comment otherwise;
 * - `CopilotKit` becomes `CopilotKitProvider`, and the v1-only props of
 *   `<CopilotKit>` are renamed or marked;
 * - Streamdown props on the `markdownRenderer` slot are marked, and calls of
 *   the removed Vue `useKatexStyles` are deleted;
 * - reads of the removed `runtime.licenseChecker` are marked.
 */
const codemod: Codemod<Lang> = async (root, options) => {
  const migrated = migrateRuntimeAdapters(root.root());
  const rootNode =
    migrated === null
      ? root.root()
      : parse<Lang>(options.language, migrated).root();
  const source = rootNode.text();
  const edits: Edit[] = [];
  /** Local names of the v1 `<CopilotKit>` provider. */
  const providerNames = new Set<string>();
  /** Provider names imported without an alias, so every reference renames. */
  const renameReferences = new Map<string, string>();

  const statements = rootNode.findAll({
    rule: {
      any: [
        { kind: "import_statement" },
        { kind: "export_statement", has: { field: "source", kind: "string" } },
      ],
    },
  });

  // Once a file uses a Fetch/Node factory, CopilotRuntime is already on the
  // AG-UI API. Do not add a v1-runtime warning on the second codemod run.
  const hasRuntimeHandler = statements.some((statement) => {
    const importSource = statement.field("source");
    return (
      importSource &&
      ["@copilotkit/runtime", "@copilotkit/runtime/node"].includes(
        unquote(importSource),
      ) &&
      (specifiersOf(statement) ?? []).some((specifier) =>
        [
          "createCopilotRuntimeHandler",
          "createCopilotNodeListener",
          "createCopilotNodeHandler",
        ].includes(specifier.name),
      )
    );
  });

  for (const statement of statements) {
    const sourceNode = statement.field("source");
    if (!sourceNode) continue;
    const from = unquote(sourceNode);
    const quote = sourceNode.text()[0] ?? '"';
    const specifiers = specifiersOf(statement);

    // TODO comments go right above the statement they are about. A line that
    // is already in the file is not added again, so a second run is a no-op.
    const todos: string[] = [];
    const replaceStatement = (text: string) => {
      const comments = [...new Set(todos)]
        .map((todo) => `// ${TODO} ${todo}`)
        .filter((line) => !source.includes(line));
      if (text === statement.text() && comments.length === 0) return;
      edits.push(statement.replace([...comments, text].join("\n")));
    };

    /** The specifier with the provider renamed, or `undefined` when it is not the provider. */
    const renameProvider = (specifier: Specifier) => {
      if (!PROVIDER_SOURCES.includes(from)) return undefined;
      const target = own(PROVIDER_RENAMES, specifier.name);
      if (!target) return undefined;
      const aliased = specifier.text.includes(" as ");
      if (!aliased) renameReferences.set(specifier.name, target);
      return specifier.text.replace(specifier.name, target);
    };

    const isRuntimeRoot =
      from === "@copilotkit/runtime" || from === "@copilotkit/runtime/v2";
    if (
      REMOVED_RUNTIME_PATHS.has(from) ||
      (isRuntimeRoot &&
        (specifiers ?? []).some(({ name }) => RUNTIME_ADAPTERS.has(name)))
    ) {
      todos.push(ADAPTER_NOTE);
      if (REMOVED_RUNTIME_PATHS.has(from)) {
        replaceStatement(statement.text());
        continue;
      }
    }

    // A side-effect import (`import "…/styles.css";`) has no import clause.
    if (
      STYLESHEETS.has(from) &&
      statement.kind() === "import_statement" &&
      !statement.find({ rule: { kind: "import_clause" } })
    ) {
      edits.push(deleteLine(statement, source));
      continue;
    }

    const to = own(PATHS, from);
    if (to !== undefined) {
      const renamed = (specifiers ?? []).map(
        (specifier) => renameProvider(specifier) ?? specifier.text,
      );
      collectProviderNames(specifiers, from, providerNames);
      const changedSpecifiers =
        specifiers !== null &&
        renamed.some((text, index) => text !== specifiers[index]!.text);
      if (changedSpecifiers) {
        replaceStatement(
          renderStatement(
            statementHead(statement),
            renamed,
            to,
            quote,
            statement.text().includes("\n"),
          ),
        );
      } else {
        replaceStatement(
          statement.text().replace(sourceNode.text(), requote(sourceNode, to)),
        );
      }
      continue;
    }

    if (own(V1_API, from) === undefined) continue;
    collectProviderNames(specifiers, from, providerNames);

    if (specifiers === null) {
      todos.push(
        `This import of "${from}" can't be migrated automatically. Import the 2.0 APIs by name: ${GUIDE}`,
      );
      replaceStatement(statement.text());
      continue;
    }

    // Group the specifiers by where they come from in 2.0.
    const groups = new Map<string, string[]>();
    let providerRenamed = false;
    for (const specifier of specifiers) {
      const provider = renameProvider(specifier);
      if (provider !== undefined) {
        providerRenamed = true;
        groups.set(from, [...(groups.get(from) ?? []), provider]);
        continue;
      }
      const entry = lookup(from, specifier.name);
      if (
        !(
          isRuntimeRoot &&
          (RUNTIME_ADAPTERS.has(specifier.name) ||
            (hasRuntimeHandler && specifier.name === "CopilotRuntime"))
        )
      ) {
        todos.push(...todoLines(specifier.name, entry));
      }
      const replacement = entry?.replacement;
      const target =
        replacement?.name === specifier.name ? replacement.importPath : from;
      groups.set(target, [...(groups.get(target) ?? []), specifier.text]);
    }
    const head = statementHead(statement);
    replaceStatement(
      groups.size === 1 && groups.has(from) && !providerRenamed
        ? statement.text()
        : [...groups]
            .map(([target, texts]) =>
              renderStatement(
                head,
                texts,
                target,
                quote,
                statement.text().includes("\n"),
              ),
            )
            .join("\n"),
    );
  }

  // Strings that name a moved path outside an import: `import()`, `require()`,
  // `vi.mock()`.
  for (const string of rootNode.findAll({ rule: { kind: "string" } })) {
    const value = unquote(string);
    const moved = own(PATHS, value);
    const parent = string.parent();
    if (parent?.kind() === "import_statement") continue;
    if (parent?.kind() === "export_statement") continue;
    if (REMOVED_RUNTIME_PATHS.has(value)) {
      const comment = `/* ${TODO} ${ADAPTER_NOTE} */`;
      if (
        !source.slice(0, string.range().start.index).trimEnd().endsWith(comment)
      ) {
        edits.push(string.replace(`${comment} ${string.text()}`));
      }
    } else if (moved !== undefined) {
      edits.push(string.replace(requote(string, moved)));
    } else if (STYLESHEETS.has(value)) {
      // `require("…/styles.css");` on its own line.
      const statement = string.parent()?.parent()?.parent();
      if (
        statement?.kind() === "expression_statement" &&
        statement.text().replace(/;$/, "") === `require(${string.text()})`
      ) {
        edits.push(deleteLine(statement, source));
      }
    }
  }

  for (const [from, to] of renameReferences) {
    const references = rootNode.findAll({
      rule: {
        any: [{ kind: "identifier" }, { kind: "type_identifier" }],
        regex: `^${from}$`,
        // The import itself is rewritten with its statement.
        not: {
          inside: {
            any: [{ kind: "import_specifier" }, { kind: "export_specifier" }],
          },
        },
      },
    });
    for (const reference of references) edits.push(reference.replace(to));
  }

  edits.push(...providerPropEdits(rootNode, providerNames, source));
  // `.ts` files use the typescript grammar, which has no JSX node kinds.
  const jsx = !/\.[mc]?ts$/.test(root.filename());
  edits.push(...markdownRendererEdits(rootNode, source, jsx));
  edits.push(...katexEdits(rootNode, source));
  edits.push(...licenseCheckerEdits(rootNode, source));

  if (edits.length === 0) return migrated;
  return rootNode.commitEdits(edits);
};

function collectProviderNames(
  specifiers: Specifier[] | null,
  from: string,
  names: Set<string>,
) {
  if (from !== "@copilotkit/react-core" && from !== "@copilotkit/react-core/v2")
    return;
  for (const specifier of specifiers ?? []) {
    if (specifier.name !== "CopilotKit") continue;
    const alias = specifier.text.split(/\s+as\s+/)[1];
    names.add(alias?.trim() ?? "CopilotKit");
  }
}

/** Renames `agent` to `agentId` on `<CopilotKit>` and marks the props 2.0 dropped. */
function providerPropEdits(
  rootNode: Node,
  providerNames: Set<string>,
  source: string,
): Edit[] {
  if (providerNames.size === 0) return [];
  const edits: Edit[] = [];
  // JSX kinds exist only in the tsx grammar; this finds nothing in a .ts file.
  const elements = (rootNode as SgNode<TSX>).findAll({
    rule: {
      any: [
        { kind: "jsx_opening_element" },
        { kind: "jsx_self_closing_element" },
      ],
    },
  });
  for (const element of elements) {
    const name = element.field("name")?.text();
    if (name === undefined || !providerNames.has(name)) continue;
    for (const attribute of element.children()) {
      if (attribute.kind() !== "jsx_attribute") continue;
      const propName = attribute.child(0);
      if (!propName) continue;
      const prop = propName.text();
      if (prop === "agent") {
        edits.push(propName.replace("agentId"));
        continue;
      }
      const message = own(V1_ONLY_PROVIDER_PROPS, prop);
      if (!message) continue;
      const edit = commentBefore(attribute, message, source);
      if (edit) edits.push(edit);
    }
  }
  return edits;
}

/** Inserts an inline TODO comment before `node`, unless it is already there. */
function commentBefore(
  node: Node | SgNode<TSX>,
  message: string,
  source: string,
): Edit | undefined {
  const comment = `/* ${TODO} ${message} */`;
  const start = node.range().start.index;
  if (source.slice(0, start).trimEnd().endsWith(comment)) return undefined;
  return { startPos: start, endPos: start, insertedText: `${comment} ` };
}

/** Deletes `node` with its indentation and line break. */
function deleteLine(node: Node, source: string): Edit {
  let startPos = node.range().start.index;
  let endPos = node.range().end.index;
  while (startPos > 0 && /[ \t]/.test(source[startPos - 1]!)) startPos--;
  if (source[endPos] === "\n") endPos++;
  return { startPos, endPos, insertedText: "" };
}

/** The name of an object key or JSX attribute, without quotes. */
function keyName(node: Node | SgNode<TSX>): string | undefined {
  switch (node.kind()) {
    case "pair":
    case "method_definition": {
      const key = node.field("key") ?? node.field("name");
      if (!key) return undefined;
      return key.kind() === "string" ? unquote(key) : key.text();
    }
    case "shorthand_property_identifier":
      return node.text();
    case "jsx_attribute":
      return node.child(0)?.text();
    default:
      return undefined;
  }
}

/**
 * Marks the Streamdown props that 2.0 dropped from the `markdownRenderer`
 * slot: `markdownRenderer={{ ... }}`, `markdownRenderer: { ... }`, and the
 * props of `<CopilotChatAssistantMessage.MarkdownRenderer>`.
 */
function markdownRendererEdits(
  rootNode: Node,
  source: string,
  jsx: boolean,
): Edit[] {
  if (!source.includes("@copilotkit/")) return [];
  const props: (Node | SgNode<TSX>)[] = [];

  // `markdownRenderer: { ... }`
  const pairs = rootNode.findAll({
    rule: {
      kind: "pair",
      has: { field: "key", regex: "^[\"']?markdownRenderer[\"']?$" },
    },
  });
  for (const pair of pairs) {
    const value = pair.field("value");
    if (value?.kind() === "object") props.push(...value.children());
  }

  if (jsx) {
    const tsxRoot = rootNode as SgNode<TSX>;
    // `markdownRenderer={{ ... }}`
    const attributes = tsxRoot.findAll({
      rule: {
        kind: "jsx_attribute",
        has: { kind: "property_identifier", regex: "^markdownRenderer$" },
      },
    });
    for (const attribute of attributes) {
      const value = attribute
        .children()
        .find((child) => child.kind() === "jsx_expression")
        ?.child(1);
      if (value?.kind() === "object") props.push(...value.children());
    }

    // `<CopilotChatAssistantMessage.MarkdownRenderer ...>`
    const elements = tsxRoot.findAll({
      rule: {
        any: [
          { kind: "jsx_opening_element" },
          { kind: "jsx_self_closing_element" },
        ],
      },
    });
    for (const element of elements) {
      const name = element.field("name")?.text() ?? "";
      if (/(^|\.)CopilotChatAssistantMessage\.MarkdownRenderer$/.test(name))
        props.push(...element.children());
    }
  }

  const edits: Edit[] = [];
  for (const prop of props) {
    const name = keyName(prop);
    const message =
      name === undefined ? undefined : own(STREAMDOWN_PROPS, name);
    if (!message) continue;
    const edit = commentBefore(prop, message, source);
    if (edit) edits.push(edit);
  }
  return edits;
}

/** Deletes the import and the calls of the Vue `useKatexStyles`. */
function katexEdits(rootNode: Node, source: string): Edit[] {
  if (!source.includes("useKatexStyles")) return [];
  const edits: Edit[] = [];
  const localNames = new Set<string>();
  const imports = rootNode.findAll({ rule: { kind: "import_statement" } });
  for (const statement of imports) {
    const sourceNode = statement.field("source");
    if (!sourceNode || !VUE_SOURCES.includes(unquote(sourceNode))) continue;
    const specifiers = specifiersOf(statement);
    const katex = specifiers?.find((s) => s.name === "useKatexStyles");
    if (!specifiers || !katex) continue;
    localNames.add(katex.text.split(/\s+as\s+/)[1]?.trim() ?? katex.name);
    const rest = specifiers.filter((s) => s !== katex).map((s) => s.text);
    edits.push(
      rest.length === 0
        ? deleteLine(statement, source)
        : statement.replace(
            renderStatement(
              statementHead(statement),
              rest,
              unquote(sourceNode),
              sourceNode.text()[0] ?? '"',
              statement.text().includes("\n"),
            ),
          ),
    );
  }
  if (localNames.size === 0) return edits;
  const calls = rootNode.findAll({
    rule: {
      kind: "expression_statement",
      has: {
        kind: "call_expression",
        has: { field: "function", kind: "identifier" },
      },
    },
  });
  for (const call of calls) {
    const callee = call.child(0)?.field("function")?.text();
    if (callee !== undefined && localNames.has(callee))
      edits.push(deleteLine(call, source));
  }
  return edits;
}

const LICENSE_CHECKER_NOTE =
  "`licenseChecker` was removed in 2.0. Use `await runtime.getLicenseChecker()`, which verifies the license on first use. See https://docs.copilotkit.ai/migrate/runtime-2.0#license-checker";

/**
 * Marks reads of the removed `licenseChecker` runtime property. The
 * replacement is async, so the codemod cannot rewrite it in place.
 */
function licenseCheckerEdits(rootNode: Node, source: string): Edit[] {
  if (!source.includes("@copilotkit/runtime")) return [];
  const accesses = rootNode.findAll({
    rule: {
      kind: "member_expression",
      has: { field: "property", regex: "^licenseChecker$" },
    },
  });
  const edits: Edit[] = [];
  for (const access of accesses) {
    const edit = commentBefore(access, LICENSE_CHECKER_NOTE, source);
    if (edit) edits.push(edit);
  }
  return edits;
}

export default codemod;
