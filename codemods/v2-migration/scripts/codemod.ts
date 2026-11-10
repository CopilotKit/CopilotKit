import { parse } from "codemod:ast-grep";
import { chatApiEdits } from "./chat-apis.ts";
import { angularCopyButtonEdits } from "./angular-copy-buttons.ts";
import { migrateAngularChatConfiguration } from "./angular-chat-configuration.ts";
import { migrateDeprecatedApis } from "./deprecated-apis.ts";
import { migrateGenerativeUI } from "./generative-ui.ts";
import { migrateRuntimeAdapters } from "./runtime-adapters.ts";
import type { Codemod, Edit, SgNode } from "codemod:ast-grep";
import type TS from "codemod:ast-grep/langs/typescript";
import type TSX from "codemod:ast-grep/langs/tsx";
import { V1_API } from "./v1-api.ts";
import type { V1Export } from "./v1-api.ts";
import { byteIndex, charIndex } from "./offsets.ts";

type Lang = TS | TSX;
type Node = SgNode<Lang>;

/** Every comment the codemod adds starts with this, so a user can grep for them. */
export const TODO = "TODO(copilotkit-2.0):";
const GUIDE = "https://docs.copilotkit.ai/migrate/v2";

/**
 * Import paths that only moved: the `/v2` subpaths are the package roots in
 * 2.0, and the server-only shared entries moved into the runtime.
 */
const PATHS: Record<string, string> = {
  "@copilotkit/react-core/v2": "@copilotkit/react-core",
  "@copilotkit/react-core/v2/headless": "@copilotkit/react-core/headless",
  "@copilotkit/react-core/v2/context": "@copilotkit/react-core/context",
  "@copilotkit/react-core/v2/generative-ui":
    "@copilotkit/react-core/generative-ui",
  "@copilotkit/runtime/v2": "@copilotkit/runtime",
  "@copilotkit/runtime/v2/node": "@copilotkit/runtime/node",
  "@copilotkit/shared/event-transforms": "@copilotkit/runtime",
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

/**
 * 1.x deprecations of `BuiltInAgent`. They are renamed here, in the import
 * pass, so the renamed import moves to `@copilotkit/runtime/agent` with the
 * other agent exports.
 */
const BASIC_AGENT_RENAMES: Record<string, string> = {
  BasicAgent: "BuiltInAgent",
  BasicAgentConfiguration: "BuiltInAgentClassicConfig",
};

/** Exports that 2.0 renamed, keyed by the source they are imported from. */
const RENAMES: Record<string, Record<string, string>> = {
  "@copilotkit/react-core": PROVIDER_RENAMES,
  "@copilotkit/react-core/v2": PROVIDER_RENAMES,
  "@copilotkit/runtime": BASIC_AGENT_RENAMES,
  "@copilotkit/runtime/v2": BASIC_AGENT_RENAMES,
};

const LANGGRAPH_EVENTS_NOTE =
  "`@ag-ui/langgraph` does not handle CopilotKit's LangGraph events (`copilotkit_emit_message`, `copilotkit_emit_state`, `copilotkit_emit_tool_call`, `copilotkit_exit` from the Python SDK). Check that your agent does not rely on them.";
const PROPS_CHANGED_NOTE =
  "Its props changed in 2.0. Check each prop against the docs.";

const AGENT_ENTRY = "@copilotkit/runtime/agent";
const AI_SDK_ENTRY = "@copilotkit/runtime/agent/ai-sdk";
const BUILT_IN_AGENT_GUIDE =
  "https://docs.copilotkit.ai/migrate/runtime-2.0#built-in-agent";
const MCP_GUIDE =
  "https://docs.copilotkit.ai/integrations/built-in-agent/mcp-servers";
const MCP_NOTE =
  'Create each MCP client with `await createMCPClient({ transport: { type: "http", url } })` from "@tanstack/ai-mcp". Then pass the clients as `mcp: { clients: [client] }`.';
const BUILT_IN_AGENT = builtInAgentOverrides();

/** Decisions made for 2.0 that the v1 snapshot does not know about. */
const OVERRIDES: Record<string, Record<string, V1Export>> = {
  "@copilotkit/runtime/langgraph": langGraphOverrides(),
  "@copilotkit/runtime": { ...langGraphOverrides(), ...BUILT_IN_AGENT },
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

/**
 * Moves made after the 2.0 release candidates. They also apply to `/v2`
 * imports, which are 2.0 APIs already, after the path becomes the root.
 */
const PATH_OVERRIDES: Record<string, Record<string, V1Export>> = {
  "@copilotkit/runtime": BUILT_IN_AGENT,
};

/**
 * `BuiltInAgent` and its helpers left the `@copilotkit/runtime` root. The
 * agent exports move to `/agent`, and the AI SDK helpers to `/agent/ai-sdk`.
 */
function builtInAgentOverrides() {
  const moveTo = (importPath: string, names: string[]) =>
    Object.fromEntries(
      names.map(
        (name) =>
          [
            name,
            { replacement: { name, importPath, docs: BUILT_IN_AGENT_GUIDE } },
          ] as const,
      ),
    );
  const removedMcpType = {
    typeOnly: true,
    docs: MCP_GUIDE,
    notes: [
      "`@copilotkit/runtime` no longer re-exports the MCP client types. Import them from `@tanstack/ai-mcp`.",
    ],
  };
  const removed = (names: string[], note: string, docs: string) =>
    Object.fromEntries(
      names.map((name) => [name, { docs, notes: [note] }] as const),
    );
  return {
    ...removed(
      ["resolveModel", "classifyModelSpec"],
      `Model strings were removed. Pass a TanStack AI text adapter such as \`openaiText("gpt-5")\` from "@tanstack/ai-openai" as \`model\`. To handle a model name forwarded from the client, set the \`resolveModel\` option of the \`BuiltInAgent\` config.`,
      BUILT_IN_AGENT_GUIDE,
    ),
    ...removed(
      ["BuiltInAgentModel", "ModelSpecifier"],
      '`model` is a TanStack AI text adapter. Use `AnyTextAdapter` from "@tanstack/ai".',
      BUILT_IN_AGENT_GUIDE,
    ),
    ...removed(
      [
        "MCPClientConfig",
        "MCPClientConfigHTTP",
        "MCPClientConfigSSE",
        "MCPClientProvider",
      ],
      MCP_NOTE,
      MCP_GUIDE,
    ),
    ...moveTo(AGENT_ENTRY, [
      "BuiltInAgent",
      "BuiltInAgentConfiguration",
      "BuiltInAgentClassicConfig",
      "BuiltInAgentFactoryConfig",
      "BuiltInAgentAISDKFactoryConfig",
      "BuiltInAgentTanStackFactoryConfig",
      "BuiltInAgentCustomFactoryConfig",
      "BuiltInAgentFactoryContext",
      "BuiltInAgentLearnedSkills",
      "BuiltInAgentLearnedSkillsOptions",
      "defineTool",
      "ToolDefinition",
      "OverridableProperty",
      "InterruptSignal",
      "convertAISDKStream",
      "convertTanStackStream",
      "convertInputToTanStackAI",
      "TanStackChatMessage",
      "TanStackInputResult",
    ]),
    ...moveTo(AI_SDK_ENTRY, [
      "convertMessagesToVercelAISDKMessages",
      "MessageConversionOptions",
      "convertToolsToVercelAITools",
      "convertToolDefinitionsToVercelAITools",
      "convertJsonSchemaToZodSchema",
      "createSafeUrlDownload",
      "CreateSafeUrlDownloadOptions",
      "SafeUrlDownloadOptions",
    ]),
    MCPClient: removedMcpType,
    MCPTransport: removedMcpType,
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

/** The name a specifier binds in this file: its alias, or its name. */
function localName(specifier: Specifier) {
  return specifier.text.split(/\s+as\s+/)[1]?.trim() ?? specifier.name;
}

/** Local names of the value imports of `names` from one of `sources`. */
function importedAs(rootNode: Node, sources: string[], names: string[]) {
  const locals = new Set<string>();
  const imports = rootNode.findAll({ rule: { kind: "import_statement" } });
  for (const statement of imports) {
    const sourceNode = statement.field("source");
    if (!sourceNode || !sources.includes(unquote(sourceNode))) continue;
    const specifiers = specifiersOf(statement) ?? [];
    for (const specifier of specifiers) {
      const isValue = !/^type\s/.test(specifier.text);
      if (isValue && names.includes(specifier.name))
        locals.add(localName(specifier));
    }
  }
  return locals;
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
 * - `BuiltInAgent` imports move to `@copilotkit/runtime/agent` (also from
 *   `/v2`), model strings become TanStack AI adapter calls, and the keys and
 *   exports that changed in 2.0 are marked;
 * - `CopilotKit` becomes `CopilotKitProvider`, and the v1-only props of
 *   `<CopilotKit>` are renamed or marked;
 * - Streamdown props on the `markdownRenderer` slot are marked, calls of the
 *   removed Vue `useKatexStyles` are deleted, and imports of the markdown AST
 *   types are marked;
 * - reads of the removed `runtime.licenseChecker` are marked;
 * - 1.x deprecations that 2.0 removed are renamed to their replacement, or
 *   marked when the replacement has a different API;
 * - subclasses of the Angular `CopilotChatConfiguration` call
 *   `setActiveThreadId` instead of the removed `_setOverride`;
 * - generative UI APIs that changed in 2.0 are rewritten or marked (see
 *   `generative-ui.ts`).
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

    /** The specifier with its 2.0 name, or `undefined` when 2.0 did not rename it. */
    const rename = (specifier: Specifier) => {
      const target = own(own(RENAMES, from), specifier.name);
      if (!target) return undefined;
      const aliased = specifier.text.includes(" as ");
      if (!aliased) renameReferences.set(specifier.name, target);
      return {
        name: target,
        text: specifier.text.replace(specifier.name, target),
      };
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
    if (to === undefined && own(V1_API, from) === undefined) continue;
    collectProviderNames(specifiers, from, providerNames);
    /** The source with its moved path: the 2.0 home of what did not move. */
    const home = to ?? from;
    const withHome = statement
      .text()
      .replace(sourceNode.text(), requote(sourceNode, home));

    if (specifiers === null) {
      if (to === undefined) {
        todos.push(
          `This import of "${from}" can't be migrated automatically. Import the 2.0 APIs by name: ${GUIDE}`,
        );
      }
      replaceStatement(withHome);
      continue;
    }

    // A moved path imports 2.0 APIs, so only PATH_OVERRIDES apply to it.
    const entryOf = (name: string) =>
      to === undefined
        ? lookup(from, name)
        : own(own(PATH_OVERRIDES, to), name);

    // Group the specifiers by where they come from in 2.0.
    const groups = new Map<string, string[]>();
    let renamedAny = false;
    for (const specifier of specifiers) {
      const renamed = rename(specifier);
      if (renamed) renamedAny = true;
      const name = renamed?.name ?? specifier.name;
      const entry = entryOf(name);
      const skipsTodo =
        renamed !== undefined ||
        (isRuntimeRoot &&
          (RUNTIME_ADAPTERS.has(name) ||
            (hasRuntimeHandler && name === "CopilotRuntime")));
      if (!skipsTodo) todos.push(...todoLines(name, entry));
      const replacement = entry?.replacement;
      const target = replacement?.name === name ? replacement.importPath : home;
      groups.set(target, [
        ...(groups.get(target) ?? []),
        renamed?.text ?? specifier.text,
      ]);
    }
    const keepsShape = groups.size === 1 && groups.has(home) && !renamedAny;
    replaceStatement(
      keepsShape
        ? withHome
        : [...groups]
            .map(([target, texts]) =>
              renderStatement(
                statementHead(statement),
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
        !source
          .slice(0, charIndex(source, string.range().start.index))
          .trimEnd()
          .endsWith(comment)
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
  edits.push(...markdownAstEdits(rootNode, source));
  edits.push(...licenseCheckerEdits(rootNode, source));
  edits.push(...chatApiEdits(rootNode, source));
  edits.push(...angularRuntimeConfigEdits(rootNode, source));
  edits.push(...angularCopyButtonEdits(rootNode, source));
  edits.push(...builtInAgentConfigEdits(rootNode, source));

  const migratedPaths =
    edits.length === 0 ? migrated : rootNode.commitEdits(edits);
  const deprecated = migrateDeprecatedApis(
    migratedPaths === null
      ? rootNode
      : parse<Lang>(options.language, migratedPaths).root(),
    jsx,
  );
  const latest = deprecated ?? migratedPaths;
  const generativeUI = migrateGenerativeUI(
    latest === null ? rootNode : parse<Lang>(options.language, latest).root(),
  );
  const afterGenerativeUI = generativeUI ?? latest;
  const angular = migrateAngularChatConfiguration(
    afterGenerativeUI === null
      ? rootNode
      : parse<Lang>(options.language, afterGenerativeUI).root(),
  );
  return angular ?? afterGenerativeUI;
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
    names.add(localName(specifier));
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
  if (source.slice(0, charIndex(source, start)).trimEnd().endsWith(comment)) {
    return undefined;
  }
  return { startPos: start, endPos: start, insertedText: `${comment} ` };
}

/** Deletes `node` with its indentation and line break. */
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
    localNames.add(localName(katex));
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

const MARKDOWN_AST_SOURCES = [
  "@copilotkit/markdown",
  "@copilotkit/markdown/react",
  "@copilotkit/markdown/vue",
];

/**
 * Types whose unions grew in 2.0, so an exhaustive `switch` or a map keyed by
 * every member stops type-checking.
 */
const MARKDOWN_AST_TYPES = new Set([
  "StreamingMarkdownAstNode",
  "StreamingMarkdownNodeType",
  "StreamingMarkdownNodeRendererKey",
  "VueStreamingMarkdownNodeRendererKey",
]);

const MARKDOWN_AST_NOTE = `The \`@copilotkit/markdown\` AST changed in 2.0. The node types include \`math\` (parsed only with the \`enableMath\` option), and a task-list item has \`checked\` and no \`[ ]\` or \`[x]\` marker in its text. Add a \`math\` case to exhaustive switches and maps keyed by node type, and read \`checked\` for task items: ${MARKDOWN_GUIDE}#code-that-reads-the-ast`;

/**
 * Marks imports of the markdown AST types. The new `math` node and the
 * task-list `checked` field need a decision in the app's own code, so the
 * codemod does not rewrite it.
 */
function markdownAstEdits(rootNode: Node, source: string): Edit[] {
  if (!source.includes("@copilotkit/markdown")) return [];
  const comment = `// ${TODO} ${MARKDOWN_AST_NOTE}`;
  if (source.includes(comment)) return [];
  const imports = rootNode.findAll({ rule: { kind: "import_statement" } });
  const statement = imports.find((candidate) => {
    const sourceNode = candidate.field("source");
    if (!sourceNode || !MARKDOWN_AST_SOURCES.includes(unquote(sourceNode)))
      return false;
    return (specifiersOf(candidate) ?? []).some((specifier) =>
      MARKDOWN_AST_TYPES.has(specifier.name),
    );
  });
  if (!statement) return [];
  const start = statement.range().start.index;
  return [{ startPos: start, endPos: start, insertedText: `${comment}\n` }];
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

const ANGULAR_SOURCE = "@copilotkit/angular";
/** One of these keys gives the Angular provider a runtime to talk to. */
const ANGULAR_RUNTIME_KEYS = new Set([
  "runtimeUrl",
  "licenseKey",
  "agents",
  "selfManagedAgents",
]);
const ANGULAR_RUNTIME_CONFIG_NOTE =
  "2.0 throws in production when `provideCopilotKit` gets no `runtimeUrl`, `licenseKey`, `agents`, or `selfManagedAgents`. Add a `runtimeUrl` here. See https://docs.copilotkit.ai/migrate/providers-2.0#angular-a-missing-runtime-throws-in-production";

/**
 * Marks `provideCopilotKit()` calls whose config has no runtime: no
 * `runtimeUrl`, `licenseKey`, `agents`, or `selfManagedAgents`. 2.0 throws for
 * them in production. Only an object literal the codemod can read in full is
 * marked: a spread, a computed key, or a variable can hold the missing key.
 */
function angularRuntimeConfigEdits(rootNode: Node, source: string): Edit[] {
  if (!source.includes(ANGULAR_SOURCE)) return [];
  const localNames = importedAs(
    rootNode,
    [ANGULAR_SOURCE],
    ["provideCopilotKit"],
  );
  if (localNames.size === 0) return [];

  const calls = rootNode.findAll({
    rule: {
      kind: "call_expression",
      has: { field: "function", kind: "identifier" },
    },
  });
  const edits: Edit[] = [];
  for (const call of calls) {
    const callee = call.field("function")?.text();
    if (callee === undefined || !localNames.has(callee)) continue;
    if (!configHasNoRuntime(call)) continue;
    const edit = commentBefore(call, ANGULAR_RUNTIME_CONFIG_NOTE, source);
    if (edit) edits.push(edit);
  }
  return edits;
}

/**
 * True only when the call's config is visible in full and names no runtime:
 * no argument, or one object literal with no spread and no computed key.
 */
function configHasNoRuntime(call: Node) {
  const args = call.field("arguments")?.children() ?? [];
  const values = args.filter(
    (child) => !["(", ")", ",", "comment"].includes(child.kind()),
  );
  if (values.length === 0) return true;
  const [config] = values;
  if (values.length > 1 || config?.kind() !== "object") return false;
  const entries = config.children().filter((child) => child.isNamed());
  for (const entry of entries) {
    if (entry.kind() === "comment") continue;
    const isComputed = entry.field("key")?.kind() === "computed_property_name";
    if (entry.kind() === "spread_element" || isComputed) return false;
    const name = keyName(entry);
    if (name === undefined) return false;
    if (ANGULAR_RUNTIME_KEYS.has(name)) return false;
  }
  return true;
}

/** Sources a `BuiltInAgent` import can come from, before and after the move. */
const AGENT_SOURCES = [
  "@copilotkit/runtime",
  "@copilotkit/runtime/v2",
  AGENT_ENTRY,
];
const AI_SDK_MODEL_NOTE = `\`model\` takes a TanStack AI text adapter such as \`openaiText("gpt-5")\` from "@tanstack/ai-openai" in 2.0, not an AI SDK model. Pass an adapter, or use a \`type: "aisdk"\` factory. See ${BUILT_IN_AGENT_GUIDE}`;
const MODEL_ADAPTER_NOTE = `\`model\` must be a TanStack AI text adapter in 2.0, such as \`openaiText("gpt-5")\` from "@tanstack/ai-openai". Model strings are not supported, so replace this value if it is one. See ${BUILT_IN_AGENT_GUIDE}`;

/** Keys that 2.0 removed from the classic `BuiltInAgent` config. */
const REMOVED_AGENT_CONFIG: Record<string, string> = {
  ...Object.fromEntries(
    [
      "maxOutputTokens",
      "temperature",
      "topP",
      "topK",
      "presencePenalty",
      "frequencyPenalty",
      "stopSequences",
      "seed",
      "providerOptions",
    ].map((key) => [
      key,
      `\`${key}\` was removed in 2.0. Pass provider-native options in \`modelOptions\`. See ${BUILT_IN_AGENT_GUIDE}`,
    ]),
  ),
  apiKey: `\`apiKey\` was removed in 2.0. The adapter reads its key from the environment, or pass it to the adapter (for example \`createOpenaiChat(model, apiKey)\`). See ${BUILT_IN_AGENT_GUIDE}`,
  urlDownload: `\`urlDownload\` was removed in 2.0. The server no longer downloads attachment URLs. See ${BUILT_IN_AGENT_GUIDE}`,
  mcpServers: `\`mcpServers\` was removed in 2.0. ${MCP_NOTE} See ${MCP_GUIDE}`,
  mcpClients: `\`mcpClients\` was removed in 2.0. ${MCP_NOTE} See ${MCP_GUIDE}`,
};

interface ModelAdapter {
  /** The adapter factory, called with the model name. */
  factory: string;
  /** The package that exports `factory`. */
  from: string;
}

const GEMINI_ADAPTER = { factory: "geminiText", from: "@tanstack/ai-gemini" };

/** The TanStack AI adapter for each provider of a 1.x model string. */
const MODEL_ADAPTERS: Record<string, ModelAdapter> = {
  openai: { factory: "openaiText", from: "@tanstack/ai-openai" },
  anthropic: { factory: "anthropicText", from: "@tanstack/ai-anthropic" },
  google: GEMINI_ADAPTER,
  gemini: GEMINI_ADAPTER,
  "google-gemini": GEMINI_ADAPTER,
  vertex: { factory: "vertexText", from: "@tanstack/ai-vertex" },
};

/**
 * The adapter for a 1.x model string such as `"openai/gpt-5"`, split at the
 * first `/` or `:` the way 1.x did. `undefined` for a provider with no adapter.
 */
function adapterFor(spec: string) {
  const trimmed = spec.trim();
  const separator = trimmed.search(/[:/]/);
  if (separator === -1) return undefined;
  const provider = trimmed.slice(0, separator).toLowerCase();
  const adapter = own(MODEL_ADAPTERS, provider);
  const model = trimmed.slice(separator + 1).trim();
  if (adapter === undefined || model === "") return undefined;
  return { ...adapter, model };
}

/** The identifier an expression starts from: `openai` in `openai.chat("gpt-4o")`. */
function rootIdentifier(node: Node): string | undefined {
  switch (node.kind()) {
    case "identifier":
    case "shorthand_property_identifier":
      return node.text();
    case "call_expression": {
      const callee = node.field("function");
      return callee ? rootIdentifier(callee) : undefined;
    }
    case "member_expression": {
      const object = node.field("object");
      return object ? rootIdentifier(object) : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Names bound from a package that `isSource` accepts: its imports, and the
 * variables built from them (`const openai = createOpenAI()`).
 */
function namesFrom(rootNode: Node, isSource: (source: string) => boolean) {
  const names = new Set<string>();
  const imports = rootNode.findAll({ rule: { kind: "import_statement" } });
  for (const statement of imports) {
    const sourceNode = statement.field("source");
    if (!sourceNode || !isSource(unquote(sourceNode))) continue;
    const clause = statement.find({ rule: { kind: "import_clause" } });
    const parts = clause?.children() ?? [];
    for (const part of parts) {
      switch (part.kind()) {
        case "identifier":
          names.add(part.text());
          break;
        case "namespace_import": {
          const binding = part.find({ rule: { kind: "identifier" } });
          if (binding) names.add(binding.text());
          break;
        }
        case "named_imports": {
          const specifiers = part.findAll({
            rule: { kind: "import_specifier" },
          });
          for (const specifier of specifiers) {
            const binding = specifier.field("alias") ?? specifier.field("name");
            if (binding) names.add(binding.text());
          }
          break;
        }
      }
    }
  }
  if (names.size === 0) return names;
  const declarators = rootNode.findAll({
    rule: { kind: "variable_declarator" },
  });
  for (const declarator of declarators) {
    const name = declarator.field("name");
    const value = declarator.field("value");
    if (name?.kind() !== "identifier" || !value) continue;
    const from = rootIdentifier(value);
    if (from !== undefined && names.has(from)) names.add(name.text());
  }
  return names;
}

/**
 * Updates a classic `new BuiltInAgent({ ... })` config for 2.0:
 *
 * - a model string with a known provider (`"openai/gpt-5"`) becomes its
 *   TanStack AI adapter call (`openaiText("gpt-5")`), and the adapter is
 *   imported;
 * - any other `model` that is not a TanStack AI adapter is marked, with an AI
 *   SDK model getting its own note;
 * - `maxRetries` moves into chat()'s retry option: `maxRetries: 3` becomes
 *   `retry: { maxRetries: 3 }`;
 * - the keys that 2.0 removed are marked. Their 2.0 values depend on the
 *   provider, so the codemod does not rewrite them.
 */
function builtInAgentConfigEdits(rootNode: Node, source: string): Edit[] {
  if (!source.includes("@copilotkit/runtime")) return [];
  const agents = importedAs(rootNode, AGENT_SOURCES, [
    "BuiltInAgent",
    "BasicAgent",
  ]);
  if (agents.size === 0) return [];
  const aiSdk = namesFrom(rootNode, (from) => from.startsWith("@ai-sdk/"));
  const tanStack = namesFrom(rootNode, (from) =>
    from.startsWith("@tanstack/ai"),
  );
  /** Adapter factories to import, by package. */
  const missing = new Map<string, Set<string>>();
  const factoryName = (adapter: ModelAdapter) => {
    const [imported] = importedAs(rootNode, [adapter.from], [adapter.factory]);
    if (imported !== undefined) return imported;
    const factories = missing.get(adapter.from) ?? new Set<string>();
    missing.set(adapter.from, factories.add(adapter.factory));
    return adapter.factory;
  };

  const constructions = rootNode.findAll({
    rule: {
      kind: "new_expression",
      has: { field: "constructor", kind: "identifier" },
    },
  });
  const edits: Edit[] = [];
  for (const construction of constructions) {
    const constructor = construction.field("constructor")?.text();
    if (constructor === undefined || !agents.has(constructor)) continue;
    const config = construction
      .field("arguments")
      ?.children()
      .find((child) => child.kind() === "object");
    const entries = config?.children() ?? [];
    for (const entry of entries) {
      const key = keyName(entry);
      if (key === undefined) continue;
      const value = entry.kind() === "pair" ? entry.field("value") : entry;
      const adapter =
        key === "model" && value?.kind() === "string"
          ? adapterFor(unquote(value))
          : undefined;
      if (value && adapter) {
        const call = `${factoryName(adapter)}(${requote(value, adapter.model)})`;
        edits.push(value.replace(call));
        continue;
      }
      if (key === "maxRetries") {
        edits.push(entry.replace(`retry: { ${entry.text()} }`));
        continue;
      }
      const message =
        key === "model"
          ? modelNote(value, aiSdk, tanStack)
          : own(REMOVED_AGENT_CONFIG, key);
      if (!message) continue;
      const edit = commentBefore(entry, message, source);
      if (edit) edits.push(edit);
    }
  }
  return [...edits, ...adapterImportEdits(rootNode, source, missing)];
}

/** The TODO for a `model` the codemod cannot rewrite. `undefined` for an adapter. */
function modelNote(
  value: Node | null,
  aiSdk: Set<string>,
  tanStack: Set<string>,
) {
  const valueRoot = value ? rootIdentifier(value) : undefined;
  if (valueRoot !== undefined && tanStack.has(valueRoot)) return undefined;
  if (valueRoot !== undefined && aiSdk.has(valueRoot)) return AI_SDK_MODEL_NOTE;
  return MODEL_ADAPTER_NOTE;
}

/**
 * Imports the adapter factories in `missing`. A factory joins an existing
 * named value import of its package. Otherwise a new import goes after the
 * last import of the file.
 */
function adapterImportEdits(
  rootNode: Node,
  source: string,
  missing: Map<string, Set<string>>,
): Edit[] {
  if (missing.size === 0) return [];
  const imports = rootNode.findAll({ rule: { kind: "import_statement" } });
  const last = imports.at(-1);
  if (last === undefined) return [];
  const quote = last.field("source")?.text()[0] ?? '"';
  const edits: Edit[] = [];
  const added: string[] = [];
  for (const [from, factories] of missing) {
    const statement = imports.find((candidate) => {
      const sourceNode = candidate.field("source");
      const specifiers = specifiersOf(candidate) ?? [];
      return (
        sourceNode !== null &&
        unquote(sourceNode) === from &&
        statementHead(candidate) === "import" &&
        specifiers.length > 0
      );
    });
    if (statement === undefined) {
      added.push(renderStatement("import", [...factories], from, quote, false));
      continue;
    }
    const sourceNode = statement.field("source");
    const specifiers = specifiersOf(statement) ?? [];
    edits.push(
      statement.replace(
        renderStatement(
          "import",
          [...specifiers.map((specifier) => specifier.text), ...factories],
          from,
          sourceNode?.text()[0] ?? quote,
          statement.text().includes("\n"),
        ),
      ),
    );
  }
  if (added.length === 0) return edits;
  // After the newline that ends the last import, so this insert never touches
  // an edit of that import.
  const end = last.range().end.index;
  const lines = added.join("\n");
  const insert =
    source[charIndex(source, end)] === "\n"
      ? { startPos: end + 1, endPos: end + 1, insertedText: `${lines}\n` }
      : { startPos: end, endPos: end, insertedText: `\n${lines}` };
  return [...edits, insert];
}

export default codemod;
