import type { Edit, SgNode } from "codemod:ast-grep";
import type TS from "codemod:ast-grep/langs/typescript";
import type TSX from "codemod:ast-grep/langs/tsx";
import { TODO, deleteLine, deleteSpecifier, own } from "./deprecated-apis.ts";

type Node = SgNode<TS | TSX>;

const GUIDE = "https://docs.copilotkit.ai/migrate/runtime-2.0";
const RUNTIME_SOURCES = ["@copilotkit/runtime", "@copilotkit/runtime/v2"];
const AGENT_FACTORY = "tanstackAIAgent";
const AGENT_SOURCE = "@copilotkit/runtime/tanstack-ai";

interface Adapter {
  /** The adapter factory, for example `openaiText`. */
  name: string;
  /** The package that exports it. */
  source: string;
}

const GEMINI: Adapter = { name: "geminiText", source: "@tanstack/ai-gemini" };

/** Classic model providers, and the TanStack AI adapter that serves each one. */
const ADAPTERS: Record<string, Adapter> = {
  openai: { name: "openaiText", source: "@tanstack/ai-openai" },
  anthropic: { name: "anthropicText", source: "@tanstack/ai-anthropic" },
  google: GEMINI,
  gemini: GEMINI,
  "google-gemini": GEMINI,
};

/** Model ids that the TanStack adapter does not list, and the id to use. */
const MODEL_IDS: Record<string, string> = { "gpt-5.4": "gpt-5.5" };

const CALL_NOTE = `Classic \`BuiltInAgent\` mode (\`model\`) was removed in 2.0, and the codemod can't map this model to a TanStack AI adapter. Use \`tanstackAIAgent({ adapter })\` from "${AGENT_SOURCE}", or \`aiSdkAgent({ model })\` from "@copilotkit/runtime/ai-sdk" with an AI SDK provider (for example \`@ai-sdk/google-vertex\`). See ${GUIDE}`;

const MODEL_OVERRIDE_NOTE = `\`"model"\` in \`overridableProperties\` needs an allowlist in 2.0. List the adapters a client can pick in \`adapters: { name: adapter }\`. See ${GUIDE}`;

const SAMPLING_OPTIONS = [
  "temperature",
  "topP",
  "topK",
  "maxOutputTokens",
  "presencePenalty",
  "frequencyPenalty",
  "stopSequences",
  "seed",
  "providerOptions",
  "toolChoice",
  "maxRetries",
];

/** Classic options that `tanstackAIAgent` does not take. */
const OPTION_NOTES: Record<string, string> = {
  apiKey: `\`apiKey\` is not a \`${AGENT_FACTORY}\` option. The adapter reads the API key from the environment. To pass a key in code, build the adapter with the create function of its package. See ${GUIDE}`,
  mcpClients: `\`mcpClients\` is not a \`${AGENT_FACTORY}\` option. List the servers in \`mcpServers\`, or add their tools to \`tools\`. See ${GUIDE}`,
  urlDownload: `\`urlDownload\` is not a \`${AGENT_FACTORY}\` option. Use \`aiSdkAgent\` from "@copilotkit/runtime/ai-sdk" to keep it. See ${GUIDE}`,
  ...Object.fromEntries(
    SAMPLING_OPTIONS.map((name) => [
      name,
      `\`${name}\` is not a \`${AGENT_FACTORY}\` option. Set it in \`modelOptions\`, with the name the adapter uses. See ${GUIDE}`,
    ]),
  ),
};

interface AgentImport {
  statement: Node;
  specifier: Node;
  /** The name the file uses for `BuiltInAgent`. */
  local: string;
}

const unquote = (node: Node) => node.text().slice(1, -1);
const named = (node: Node) =>
  node
    .children()
    .filter((child) => child.isNamed() && child.kind() !== "comment");

/** The name of an object property, without quotes. */
function propName(node: Node) {
  if (node.kind() === "shorthand_property_identifier") return node.text();
  if (node.kind() !== "pair") return undefined;
  const key = node.field("key");
  if (!key) return undefined;
  return key.kind() === "string" ? unquote(key) : key.text();
}

/** Every `BuiltInAgent` specifier imported from the runtime root. */
function agentImports(rootNode: Node) {
  const statements = rootNode.findAll({ rule: { kind: "import_statement" } });
  const imports: AgentImport[] = [];
  for (const statement of statements) {
    const sourceNode = statement.field("source");
    if (!sourceNode || !RUNTIME_SOURCES.includes(unquote(sourceNode))) continue;
    const specifiers = statement.findAll({
      rule: { kind: "import_specifier" },
    });
    for (const specifier of specifiers) {
      if (specifier.field("name")?.text() !== "BuiltInAgent") continue;
      const local = specifier.field("alias")?.text() ?? "BuiltInAgent";
      imports.push({ statement, specifier, local });
    }
  }
  return imports;
}

/**
 * The properties of a classic config: one object argument with a `model` and
 * no `factory`. Factory-mode calls and non-literal arguments give `null`.
 */
function classicConfig(call: Node) {
  const argumentList = call.field("arguments");
  const args = argumentList ? named(argumentList) : [];
  const [config] = args;
  if (args.length !== 1 || config?.kind() !== "object") return null;
  const properties = named(config);
  const names = properties.map(propName);
  if (names.includes("factory")) return null;
  const model = properties.find((property) => propName(property) === "model");
  if (!argumentList || !model) return null;
  return { argumentList, model, properties };
}

/** The adapter call for a `model: "provider/id"` property, or `null`. */
function adapterFor(model: Node) {
  const value = model.kind() === "pair" ? model.field("value") : null;
  if (value?.kind() !== "string") return null;
  const spec = unquote(value).trim();
  const separator = spec.search(/[:/]/);
  if (separator === -1) return null;
  const adapter = own(ADAPTERS, spec.slice(0, separator).toLowerCase());
  const id = spec.slice(separator + 1).trim();
  if (!adapter || id === "") return null;
  const quote = value.text()[0];
  const modelId = own(MODEL_IDS, id) ?? id;
  return { ...adapter, call: `${adapter.name}(${quote}${modelId}${quote})` };
}

function overridesModel(property: Node) {
  const value = property.kind() === "pair" ? property.field("value") : null;
  if (value?.kind() !== "array") return false;
  return named(value).some(
    (element) => element.kind() === "string" && unquote(element) === "model",
  );
}

/**
 * ast-grep positions (`range().start.index`, edit `startPos`) count UTF-8
 * bytes; JavaScript strings count UTF-16 code units. These convert between
 * the two, so a multi-byte character earlier in the file does not shift an
 * edit.
 */
function utf8Length(text: string) {
  let length = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    length += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return length;
}

function toByteIndex(source: string, charIndex: number) {
  return utf8Length(source.slice(0, charIndex));
}

function toCharIndex(source: string, byteIndex: number) {
  let bytes = 0;
  let index = 0;
  for (const char of source) {
    if (bytes >= byteIndex) break;
    bytes += utf8Length(char);
    index += char.length;
  }
  return index;
}

/** The `// ...` lines right above `lineStart`, trimmed. */
function commentsAbove(source: string, lineStart: number) {
  const lines = source
    .slice(0, lineStart)
    .split("\n")
    .slice(0, -1)
    .toReversed();
  const comments = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("//")) break;
    comments.add(trimmed);
  }
  return comments;
}

/**
 * Rewrites classic `new BuiltInAgent({ model: "openai/gpt-5.5", ... })` to
 * `tanstackAIAgent({ adapter: () => openaiText("gpt-5.5"), ... })` from
 * `@copilotkit/runtime/tanstack-ai`, and adds the adapter import.
 *
 * - `maxSteps` becomes `maxIterations`.
 * - Options `tanstackAIAgent` does not take (`apiKey`, `mcpClients`,
 *   `urlDownload`, sampling options, a `"model"` override) get a TODO.
 * - A model with no TanStack AI adapter, or a model that is not a string
 *   literal, keeps the call and gets a TODO.
 * - `BuiltInAgent` leaves the import when the file no longer uses it.
 *   Factory-mode calls are not changed.
 *
 * @param rootNode The file, after the `/v2` paths and `BasicAgent` are migrated.
 * @returns The new file text, or `null` when the file does not change.
 */
export function migrateClassicBuiltInAgent(rootNode: Node) {
  const source = rootNode.text();
  if (!source.includes("BuiltInAgent")) return null;
  const imports = agentImports(rootNode);
  const locals = new Set(imports.map(({ local }) => local));
  if (locals.size === 0) return null;

  const edits: Edit[] = [];
  /** TODO messages, keyed by the start of the line they go above. */
  const notes = new Map<number, string[]>();
  const note = (node: Node, message: string) => {
    const start = toCharIndex(source, node.range().start.index);
    const lineStart = source.lastIndexOf("\n", start - 1) + 1;
    const messages = notes.get(lineStart) ?? [];
    if (!messages.includes(message)) messages.push(message);
    notes.set(lineStart, messages);
  };
  /** Adapter imports to add: name to package. */
  const adapters = new Map<string, string>();
  /** Rewritten calls per local name of `BuiltInAgent`. */
  const rewritten = new Map<string, number>();

  const calls = rootNode.findAll({ rule: { kind: "new_expression" } });
  for (const call of calls) {
    const local = call.field("constructor")?.text();
    if (local === undefined || !locals.has(local)) continue;
    const config = classicConfig(call);
    if (!config) continue;
    const adapter = adapterFor(config.model);
    if (!adapter) {
      note(call, CALL_NOTE);
      continue;
    }
    edits.push({
      startPos: call.range().start.index,
      endPos: config.argumentList.range().start.index,
      insertedText: AGENT_FACTORY,
    });
    // Lazy form: adapter factories read the API key when called and throw
    // when it is missing. A function runs on the first agent run, so
    // importing or building the app works without the key.
    edits.push(config.model.replace(`adapter: () => ${adapter.call}`));
    adapters.set(adapter.name, adapter.source);
    rewritten.set(local, (rewritten.get(local) ?? 0) + 1);

    for (const property of config.properties) {
      const name = propName(property);
      switch (name) {
        case undefined:
        case "model":
          break;
        case "maxSteps": {
          const key = property.field("key");
          edits.push(
            key
              ? key.replace("maxIterations")
              : property.replace("maxIterations: maxSteps"),
          );
          break;
        }
        case "overridableProperties":
          if (overridesModel(property)) note(property, MODEL_OVERRIDE_NOTE);
          break;
        default: {
          const message = own(OPTION_NOTES, name);
          if (message !== undefined) note(property, message);
        }
      }
    }
  }

  // Insertions go first: at the same position as a replacement, the edit
  // listed first wins.
  const commentEdits: Edit[] = [];
  for (const [lineStart, messages] of notes) {
    const existing = commentsAbove(source, lineStart);
    const indent = /^[ \t]*/.exec(source.slice(lineStart))?.[0] ?? "";
    const lines = messages
      .map((message) => `// ${TODO} ${message}`)
      .filter((line) => !existing.has(line))
      .map((line) => `${indent}${line}\n`);
    if (lines.length === 0) continue;
    const position = toByteIndex(source, lineStart);
    commentEdits.push({
      startPos: position,
      endPos: position,
      insertedText: lines.join(""),
    });
  }

  edits.push(...importEdits(rootNode, imports, rewritten, adapters));
  const allEdits = [...commentEdits, ...edits];
  if (allEdits.length === 0) return null;
  return rootNode.commitEdits(allEdits);
}

/**
 * Adds the `tanstackAIAgent` and adapter imports after the first rewritten
 * `BuiltInAgent` import, and drops `BuiltInAgent` where nothing uses it now.
 */
function importEdits(
  rootNode: Node,
  imports: AgentImport[],
  rewritten: Map<string, number>,
  adapters: Map<string, string>,
) {
  const source = rootNode.text();
  const references = rootNode
    .findAll({
      rule: {
        any: [
          { kind: "identifier" },
          { kind: "type_identifier" },
          { kind: "shorthand_property_identifier" },
        ],
        not: { inside: { kind: "import_specifier" } },
      },
    })
    .map((node) => node.text());
  const isUnused = (local: string) => {
    const uses = references.filter((name) => name === local).length;
    return uses === (rewritten.get(local) ?? 0);
  };

  const imported = new Set(
    rootNode
      .findAll({ rule: { kind: "import_statement" } })
      .flatMap((statement) => {
        const from = statement.field("source");
        const specifiers = statement.findAll({
          rule: { kind: "import_specifier" },
        });
        return from
          ? specifiers.map(
              (specifier) => `${unquote(from)}:${specifier.text()}`,
            )
          : [];
      }),
  );
  const anchor = imports.find(({ local }) => rewritten.has(local))?.statement;
  if (!anchor) return [];
  const quote = anchor.field("source")?.text()[0] ?? '"';
  const semicolon = anchor.text().endsWith(";") ? ";" : "";
  const wanted = [[AGENT_FACTORY, AGENT_SOURCE], ...adapters];
  const importText = wanted
    .filter(([name, from]) => !imported.has(`${from}:${name}`))
    .map(
      ([name, from]) =>
        `import { ${name} } from ${quote}${from}${quote}${semicolon}`,
    )
    .join("\n");

  const edits: Edit[] = [];
  const statements = [...new Set(imports.map(({ statement }) => statement))];
  for (const statement of statements) {
    const unused = imports.filter(
      (entry) =>
        entry.statement === statement &&
        rewritten.has(entry.local) &&
        isUnused(entry.local),
    );
    const specifiers = statement.findAll({
      rule: { kind: "import_specifier" },
    });
    const clause = statement.find({ rule: { kind: "import_clause" } });
    const hasOnlyNamed =
      clause?.children().every((child) => child.kind() === "named_imports") ??
      false;
    const isEmptied = hasOnlyNamed && unused.length === specifiers.length;
    const isAnchor = statement === anchor && importText !== "";

    if (isEmptied && isAnchor) {
      edits.push(statement.replace(importText));
      continue;
    }
    if (isEmptied) {
      edits.push(deleteLine(statement, source));
      continue;
    }
    for (const { specifier } of unused)
      edits.push(deleteSpecifier(specifier, source));
    if (isAnchor) {
      const end = statement.range().end.index;
      edits.push({
        startPos: end,
        endPos: end,
        insertedText: `\n${importText}`,
      });
    }
  }
  return edits;
}
