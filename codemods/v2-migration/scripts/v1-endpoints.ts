import type { Edit } from "codemod:ast-grep";
import {
  applyEdits,
  argumentNodes,
  indentOf,
  keyOf,
  valueOf,
} from "./ast-helpers.ts";
import type { Node } from "./ast-helpers.ts";
import { byteIndex, charIndex } from "./offsets.ts";
import { migrateV1Calls } from "./v1-calls.ts";

const RUNTIME = "@copilotkit/runtime";
const AGENT_ENTRY = "@copilotkit/runtime/agent";

/**
 * v1 service adapters and the TanStack AI adapter of the same provider, with
 * the model v1 used when none was given.
 */
const SERVICE_ADAPTERS: Record<
  string,
  { factory: string; from: string; model: string } | null
> = {
  OpenAIAdapter: {
    factory: "openaiText",
    from: "@tanstack/ai-openai",
    model: "gpt-6-luna",
  },
  AnthropicAdapter: {
    factory: "anthropicText",
    from: "@tanstack/ai-anthropic",
    model: "claude-opus-4-8",
  },
  GoogleGenerativeAIAdapter: {
    factory: "geminiText",
    from: "@tanstack/ai-gemini",
    model: "gemini-3.5-flash",
  },
  // No model: the runtime serves only its agents.
  ExperimentalEmptyAdapter: null,
};

/**
 * Rewrites the v1 Next.js App Router endpoint:
 *
 * ```ts
 * const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
 *   runtime, serviceAdapter, endpoint: "/api/copilotkit",
 * });
 * return handleRequest(req);
 * ```
 *
 * to the 2.0 handler on the same route: `createCopilotRuntimeHandler({
 * runtime, basePath, mode: "single-route" })`. The 2.0 client finds a
 * single-route runtime on its own, so the route file stays where it is, and
 * `handleRequest(req)` keeps working.
 *
 * The service adapter becomes the runtime's `default` agent, the one v1 ran
 * the chat on: `new OpenAIAdapter({ model })` is `new BuiltInAgent({ model:
 * openaiText(model) })` (likewise Anthropic and Google), with v1's default
 * model when none was given. `ExperimentalEmptyAdapter` adds no agent.
 *
 * An adapter with other options (an own client, ...), another adapter, a
 * runtime with `remoteEndpoints` or `actions`, or code this does not follow
 * keeps the TODO.
 */
export function migrateV1Endpoints(
  rootNode: Node,
  reparse: (text: string) => Node,
): string | null {
  return migrateV1Calls(
    rootNode,
    "copilotRuntimeNextJSAppRouterEndpoint",
    (call, { source }) => convertEndpoint(rootNode, call, source),
    { source: RUNTIME, reparse },
  );
}

function convertEndpoint(rootNode: Node, call: Node, source: string) {
  // `const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({...})`
  const declarator = call.parent();
  if (declarator?.kind() !== "variable_declarator") return null;
  const pattern = declarator.field("name");
  if (pattern?.kind() !== "object_pattern") return null;
  const bound = pattern
    .children()
    .filter((child) => !["{", "}", ","].includes(child.kind()));
  if (bound.length !== 1) return null;
  const [binding] = bound;
  let local: string;
  if (binding!.kind() === "shorthand_property_identifier_pattern") {
    if (binding!.text() !== "handleRequest") return null;
    local = "handleRequest";
  } else if (binding!.kind() === "pair_pattern") {
    if (binding!.field("key")?.text() !== "handleRequest") return null;
    const value = binding!.field("value");
    if (value?.kind() !== "identifier") return null;
    local = value.text();
  } else {
    return null;
  }

  const args = argumentNodes(call);
  const [config] = args;
  if (config?.kind() !== "object" || args.length !== 1) return null;
  const entries = new Map<string, Node>();
  for (const entry of config.children()) {
    if (["{", "}", ",", "comment"].includes(entry.kind())) continue;
    const key = keyOf(entry);
    if (!key || !["runtime", "serviceAdapter", "endpoint"].includes(key))
      return null;
    entries.set(key, entry);
  }
  const runtime = valueOf(entries.get("runtime"));
  const endpoint = valueOf(entries.get("endpoint"));
  if (!runtime || !endpoint) return null;

  const edits: Edit[] = [];
  const imports: Record<string, string[]> = {};
  const drop: string[] = [];

  // The service adapter: inline, or a module-level `const`.
  const adapterValue = valueOf(entries.get("serviceAdapter"));
  let model: string | null = null;
  if (adapterValue) {
    const adapter = resolveConst(rootNode, adapterValue);
    if (!adapter || adapter.node.kind() !== "new_expression") return null;
    const name = adapter.node.field("constructor")?.text() ?? "";
    if (!Object.hasOwn(SERVICE_ADAPTERS, name)) return null;
    const target = SERVICE_ADAPTERS[name];
    drop.push(name);
    if (target) {
      const given = adapterModel(adapter.node);
      if (given === undefined) return null;
      model = `${target.factory}(${given ?? JSON.stringify(target.model)})`;
      imports[target.from] = [target.factory];
    }
    if (adapter.declaration)
      edits.push(deleteStatement(adapter.declaration, source));
  }

  // The runtime: inline, or a module-level `const`. A model becomes its
  // `default` agent.
  const resolved = resolveConst(rootNode, runtime);
  if (!resolved || resolved.node.kind() !== "new_expression") return null;
  if (resolved.node.field("constructor")?.text() !== "CopilotRuntime")
    return null;
  const runtimeEdits: Edit[] = [];
  if (model) {
    const agentEdit = addDefaultAgent(
      resolved.node,
      `new BuiltInAgent({ model: ${model} })`,
      source,
    );
    if (!agentEdit) return null;
    runtimeEdits.push(agentEdit);
    imports[AGENT_ENTRY] = ["BuiltInAgent"];
  } else if (!runtimeIsSupported(resolved.node)) {
    return null;
  } else if (argumentNodes(resolved.node).length === 0) {
    // 2.0 takes the options object: no model and no agents is `{ agents: {} }`.
    const args = resolved.node.field("arguments");
    const end = resolved.node.range().end.index;
    runtimeEdits.push(
      args
        ? args.replace("({ agents: {} })")
        : { startPos: end, endPos: end, insertedText: "({ agents: {} })" },
    );
  }
  // An inline runtime is part of the replaced declaration: its edits go into
  // the replacement text instead.
  const inline =
    resolved.node === runtime ||
    resolved.node.range().start.index === runtime.range().start.index;
  const runtimeText = inline
    ? applyEdits(resolved.node, runtimeEdits)
    : runtime.text();
  if (!inline) edits.push(...runtimeEdits);

  const indent = indentOf(declarator.parent() ?? call, source);
  edits.push(
    declarator
      .parent()!
      .replace(
        [
          `const ${local} = createCopilotRuntimeHandler({`,
          runtimeText === "runtime"
            ? "  runtime,"
            : `  runtime: ${runtimeText},`,
          `  basePath: ${endpoint.text()},`,
          `  mode: "single-route",`,
          `});`,
        ].join(`\n${indent}`),
      ),
  );
  return {
    edits,
    hooks: ["createCopilotRuntimeHandler"],
    imports,
    dropIfUnused: drop,
  };
}

/**
 * The expression a value stands for: itself, or the initializer of the
 * module-level `const` it names (with that declaration, when nothing else
 * uses the name).
 */
function resolveConst(
  rootNode: Node,
  value: Node,
): { node: Node; declaration?: Node } | null {
  if (
    value.kind() !== "identifier" &&
    value.kind() !== "shorthand_property_identifier"
  ) {
    return { node: value };
  }
  const name = value.text();
  const declarators = rootNode.findAll({
    rule: {
      kind: "variable_declarator",
      has: { field: "name", kind: "identifier", regex: `^${name}$` },
    },
  });
  if (declarators.length !== 1) return null;
  const declarator = declarators[0]!;
  const declaration = declarator.parent();
  const initial = declarator.field("value");
  if (!initial || declaration?.parent()?.kind() !== "program") return null;
  const uses = rootNode.findAll({
    rule: { kind: "identifier", regex: `^${name}$` },
  }).length;
  // The declaration and this use: the declaration can go with the value.
  return {
    node: initial,
    declaration:
      uses <= 2 &&
      declaration.findAll({ rule: { kind: "variable_declarator" } }).length ===
        1
        ? declaration
        : undefined,
  };
}

/**
 * The model of `new XAdapter({ model })`: its text, `null` for no model, or
 * `undefined` for options this does not carry over (an own client, ...).
 */
function adapterModel(construction: Node): string | null | undefined {
  const args = argumentNodes(construction);
  if (args.length === 0) return null;
  const [options] = args;
  if (args.length !== 1 || options?.kind() !== "object") return undefined;
  let model: string | null = null;
  for (const entry of options.children()) {
    if (["{", "}", ",", "comment"].includes(entry.kind())) continue;
    if (keyOf(entry) !== "model") return undefined;
    model = valueOf(entry)?.text() ?? null;
  }
  return model;
}

/** Keys of the v1 runtime config that 2.0 does not take. */
function runtimeIsSupported(construction: Node): boolean {
  const [config] = argumentNodes(construction);
  if (config === undefined) return true;
  if (config.kind() !== "object") return false;
  return config
    .children()
    .filter((entry) => !["{", "}", ",", "comment"].includes(entry.kind()))
    .every((entry) => keyOf(entry) === "agents");
}

/** Adds `default: <agent>` to `new CopilotRuntime({ agents })`. */
function addDefaultAgent(
  construction: Node,
  agent: string,
  source: string,
): Edit | null {
  if (!runtimeIsSupported(construction)) return null;
  const args = construction.field("arguments");
  if (!args) {
    // `new CopilotRuntime` without parentheses.
    const end = construction.range().end.index;
    return {
      startPos: end,
      endPos: end,
      insertedText: `({ agents: { default: ${agent} } })`,
    };
  }
  const [config] = argumentNodes(construction);
  if (config === undefined)
    return args.replace(`({ agents: { default: ${agent} } })`);
  const agentsEntry = config
    .children()
    .find((entry) => keyOf(entry) === "agents");
  if (!agentsEntry) {
    const open = config.range().start.index + 1;
    return {
      startPos: open,
      endPos: open,
      insertedText: ` agents: { default: ${agent} },`,
    };
  }
  const agents = valueOf(agentsEntry);
  if (agents?.kind() !== "object") return null;
  if (agents.children().some((entry) => keyOf(entry) === "default"))
    return null;
  const open = agents.range().start.index + 1;
  const inner = indentOf(agentsEntry, source);
  return {
    startPos: open,
    endPos: open,
    insertedText: `\n${inner}  default: ${agent},`,
  };
}

/**
 * Deletes a statement with its line, and the `//` comment lines right above
 * it, which describe it.
 */
function deleteStatement(statement: Node, source: string): Edit {
  let start = charIndex(source, statement.range().start.index);
  let end = charIndex(source, statement.range().end.index);
  while (start > 0 && /[ \t]/.test(source[start - 1]!)) start--;
  for (;;) {
    const previousEnd = start - 1;
    if (previousEnd < 0 || source[previousEnd] !== "\n") break;
    const previousStart = source.lastIndexOf("\n", previousEnd - 1) + 1;
    if (!/^\s*\/\//.test(source.slice(previousStart, previousEnd))) break;
    start = previousStart;
  }
  if (source[end] === "\n") end++;
  // Between two blank lines, one of them goes too.
  if (source.slice(start - 2, start) === "\n\n" && source[end] === "\n") end++;
  return {
    startPos: byteIndex(source, start),
    endPos: byteIndex(source, end),
    insertedText: "",
  };
}
