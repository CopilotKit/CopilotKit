import type { SgNode } from "codemod:ast-grep";
import type TS from "codemod:ast-grep/langs/typescript";
import type TSX from "codemod:ast-grep/langs/tsx";

type Node = SgNode<TS | TSX>;

/**
 * Some names exist at the same import path in v1 and in 2.0, with a different
 * API: `useFrontendTool` from `@copilotkit/react-core` took a `Parameter[]` in
 * v1 and takes a schema in 2.0. A v1 app imports the v1 one from the package
 * root and the 2.0 one from `/v2`. After the codemod both come from the root,
 * so a second run cannot tell them apart by the import.
 *
 * For these names the TODO depends on how the file uses them: only a use in
 * the v1 shape gets one. A second run then changes nothing, and a file that
 * already uses the 2.0 API gets no TODO it does not need.
 *
 * Each check returns whether the file uses `local` (the name bound by the
 * import) in its v1 shape.
 */
export const V1_SHAPES: Record<
  string,
  Record<string, (root: Node, local: string) => boolean>
> = {
  "@copilotkit/react-core": {
    useFrontendTool: passesParameterArray,
    useHumanInTheLoop: passesParameterArray,
    // v1 registered a renderer from a config; the 2.0 hook takes no argument.
    useRenderToolCall: (root, local) =>
      callsOf(root, local).some((call) => argumentsOf(call).length > 0),
  },
  "@copilotkit/runtime": {
    CopilotRuntime: constructsV1Runtime,
  },
};

/** Keys of the v1 `CopilotRuntime` config that 2.0 does not have. */
const V1_RUNTIME_KEYS = new Set([
  "remoteEndpoints",
  "remoteActions",
  "actions",
  "langserve",
  "observability_c",
  "onBeforeRequest",
  "onAfterRequest",
]);

/** Calls of `local(...)` in the file. */
function callsOf(root: Node, local: string): Node[] {
  return root.findAll({
    rule: {
      kind: "call_expression",
      has: { field: "function", kind: "identifier", regex: `^${local}$` },
    },
  });
}

/** The argument nodes of a call or `new` expression. */
function argumentsOf(call: Node): Node[] {
  return (call.field("arguments")?.children() ?? []).filter(
    (child) => !["(", ")", ",", "comment"].includes(child.kind()),
  );
}

/** The value of key `key` in an object literal, or `undefined`. */
function valueOf(object: Node, key: string): Node | null | undefined {
  for (const entry of object.children()) {
    if (
      entry.kind() === "shorthand_property_identifier" &&
      entry.text() === key
    ) {
      return entry;
    }
    if (entry.kind() !== "pair") continue;
    const name = entry.field("key");
    const text =
      name?.kind() === "string" ? name.text().slice(1, -1) : name?.text();
    if (text === key) return entry.field("value");
  }
  return undefined;
}

/** Whether a `parameters` value is the v1 `Parameter[]`. */
function isParameterArray(root: Node, value: Node): boolean {
  if (value.kind() === "array") return true;
  if (
    value.kind() !== "identifier" &&
    value.kind() !== "shorthand_property_identifier"
  ) {
    return false;
  }
  // A variable of the file: an array literal, or typed as `Parameter[]`.
  const declarator = root.find({
    rule: {
      kind: "variable_declarator",
      has: { field: "name", kind: "identifier", regex: `^${value.text()}$` },
    },
  });
  if (!declarator) return false;
  const initial = declarator.field("value");
  if (initial?.kind() === "array") return true;
  const type = declarator.field("type")?.text() ?? "";
  return /\bParameter\b/.test(type);
}

function passesParameterArray(root: Node, local: string): boolean {
  return callsOf(root, local).some((call) => {
    const [config] = argumentsOf(call);
    if (config?.kind() !== "object") return false;
    const parameters = valueOf(config, "parameters");
    return parameters ? isParameterArray(root, parameters) : false;
  });
}

function constructsV1Runtime(root: Node, local: string): boolean {
  const constructions = root.findAll({
    rule: {
      kind: "new_expression",
      has: { field: "constructor", kind: "identifier", regex: `^${local}$` },
    },
  });
  return constructions.some((construction) => {
    const [config] = argumentsOf(construction);
    // `new CopilotRuntime()` ran on a v1 service adapter.
    if (config === undefined) return true;
    if (config.kind() !== "object") return false;
    if (valueOf(config, "agents") === undefined) return true;
    return config.children().some((entry) => {
      const key = entry.field("key")?.text() ?? entry.text();
      return V1_RUNTIME_KEYS.has(key);
    });
  });
}
