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
  "@copilotkit/react-core/v2/styles.css": "@copilotkit/react-core/styles.css",
  "@copilotkit/react-ui/v2/styles.css": "@copilotkit/react-core/styles.css",
  "@copilotkit/react-ui/styles.css": "@copilotkit/react-core/styles.css",
  "@copilotkit/runtime/v2": "@copilotkit/runtime",
  "@copilotkit/runtime/v2/node": "@copilotkit/runtime/node",
};

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
function unquote(node: Node) {
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
 * - `CopilotKitProvider` becomes `CopilotKit`, and the v1-only props of
 *   `<CopilotKit>` are renamed or marked.
 */
const codemod: Codemod<Lang> = async (root) => {
  const rootNode = root.root();
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
      if (!(isRuntimeRoot && RUNTIME_ADAPTERS.has(specifier.name))) {
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

  if (edits.length === 0) return null;
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
      const comment = `/* ${TODO} ${message} */`;
      const before = source.slice(0, attribute.range().start.index);
      if (before.trimEnd().endsWith(comment)) continue;
      const start = attribute.range().start.index;
      edits.push({
        startPos: start,
        endPos: start,
        insertedText: `${comment} `,
      });
    }
  }
  return edits;
}

export default codemod;
