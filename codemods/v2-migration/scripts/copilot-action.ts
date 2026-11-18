import type { Edit } from "codemod:ast-grep";
import {
  argumentNodes,
  indentOf,
  keyOf,
  propertyKey,
  removeEntry,
  stringLiteral,
  valueOf,
} from "./ast-helpers.ts";
import type { Node } from "./ast-helpers.ts";
import { charIndex } from "./offsets.ts";
import { migrateV1Calls } from "./v1-calls.ts";
import type { CallContext } from "./v1-calls.ts";

const TODO = "TODO(copilotkit-2.0):";

/** The TODO for a render that reads `result`, with the page about it. */
function resultNote(docs: string) {
  return `\`result\` is the tool's result as a string in 2.0; v1 parsed it as JSON first. Parse it with \`JSON.parse\` where you need the object. ${docs}`;
}

/** What a hook choice reads from a v1 config. */
interface ActionConfig {
  /** The entries of the config, by key. */
  entries: Map<string, Node>;
  /** The `available` string, when the config has one. */
  availability: string | undefined;
  /** `renderAndWaitForResponse` or `renderAndWait`, when the config has one. */
  waitKey: string | undefined;
}

/** How the v1 `useCopilotAction` of one framework read its config. */
interface ActionDialect {
  /** The package the v1 hook came from. The 2.0 hooks come from it too. */
  source: string;
  /** The config keys the v1 hook took. A call with another key is left. */
  keys: Set<string>;
  /**
   * The 2.0 hook for a call, picked the way the v1 hook dispatched it, or
   * `null` to leave the call.
   */
  hookFor: (config: ActionConfig) => string | null;
  /**
   * The `available` string that becomes `available: false` on
   * `useFrontendTool` and `useHumanInTheLoop`. Other strings are dropped.
   */
  unavailable: string;
  /**
   * Render props of a `renderAndWaitForResponse` that v1 passed under
   * another name, by that name. With none, the render is kept as it is, so
   * it can also be a function or component the file does not define.
   */
  waitRenames?: Record<string, string>;
  /** The TODO for a render that reads `result`. */
  resultNote: string;
}

/** The config keys of both the React and the Vue v1 hook. */
const ACTION_KEYS = [
  "name",
  "description",
  "parameters",
  "handler",
  "render",
  "renderAndWaitForResponse",
  "renderAndWait",
  "followUp",
  "available",
  "webmcp",
];

const REACT: ActionDialect = {
  source: "@copilotkit/react-core",
  keys: new Set([...ACTION_KEYS, "disabled"]),
  hookFor: reactHook,
  unavailable: "disabled",
  // v1 passed the respond callback as `handler` too.
  waitRenames: { handler: "respond" },
  resultNote: resultNote(
    "https://docs.copilotkit.ai/reference/v2/hooks/useFrontendTool",
  ),
};

const VUE: ActionDialect = {
  source: "@copilotkit/vue",
  keys: new Set([...ACTION_KEYS, "agentId"]),
  hookFor: vueHook,
  // v1 hid a "remote" action from the agent.
  unavailable: "remote",
  resultNote: resultNote(
    "https://docs.copilotkit.ai/reference/vue/hooks/useFrontendTool",
  ),
};

/**
 * Rewrites v1 `useCopilotAction(...)` calls from `@copilotkit/react-core` to
 * the 2.0 hook that does the same job, the way v1 itself dispatched them:
 *
 * - `renderAndWaitForResponse` / `renderAndWait` → `useHumanInTheLoop`, with
 *   the key renamed to `render`;
 * - a `handler`, or `available: "enabled" | "remote"` → `useFrontendTool`;
 * - a `render` with no `handler`, or `available: "frontend" | "disabled"` →
 *   `useRenderTool`. Its render props name the arguments `parameters`, so
 *   the render function reads them under that name.
 *
 * A `Parameter[]` literal becomes the equivalent zod schema, built by the
 * same rules as v1's `getZodParameters`. `available: "disabled"` becomes
 * `available: false`.
 *
 * A call is rewritten only when every part of it converts. Any other call
 * (a catch-all `"*"`, a spread, `parameters` that are not a literal, a key
 * the rules do not cover, ...) is left for the TODO the import pass adds.
 *
 * Returns the new source, or `null` when nothing changed.
 */
export function migrateCopilotActions(rootNode: Node) {
  return migrateActions(rootNode, REACT);
}

/**
 * Rewrites v1 `useCopilotAction(...)` calls from `@copilotkit/vue` the same
 * way, by the rules of the v1 Vue hook:
 *
 * - `renderAndWaitForResponse` / `renderAndWait` → `useHumanInTheLoop`. v1
 *   passed it only the name, description, parameters, render and `agentId`,
 *   so a call with another key is left;
 * - `available: "frontend" | "disabled"` → `useRenderTool`. v1 drew nothing
 *   without `render` and `parameters`, and ignored a `handler`, so a call
 *   like that is left;
 * - any other call → `useFrontendTool`, also a `render` with no `handler`.
 *   `available: "remote"` becomes `available: false`.
 *
 * The render of `useFrontendTool` and `useHumanInTheLoop` gets the same props
 * as in v1, so it is kept as it is, also when it is a component. The render
 * of `useRenderTool` reads the arguments as `parameters`. v1 parsed a JSON
 * `result` for a render function, so a render that reads `result` gets a
 * TODO. The deps stay: the 2.0 hooks take them too.
 *
 * Returns the new source, or `null` when nothing changed.
 */
export function migrateVueCopilotActions(rootNode: Node) {
  return migrateActions(rootNode, VUE);
}

function migrateActions(rootNode: Node, dialect: ActionDialect) {
  return migrateV1Calls(
    rootNode,
    "useCopilotAction",
    (call, context) => {
      const converted = convertCall(call, context, dialect);
      if (!converted) return null;
      if (converted.usesZod) context.useZod();
      return { edits: converted.edits, hooks: [converted.hook] };
    },
    { source: dialect.source },
  );
}

/** The React v1 dispatch. */
function reactHook({ entries, availability, waitKey }: ActionConfig) {
  if (waitKey) {
    const isMixed =
      entries.has("render") ||
      entries.has("handler") ||
      availability === "frontend";
    return isMixed ? null : "useHumanInTheLoop";
  }
  switch (availability) {
    case "enabled":
    case "remote":
      return "useFrontendTool";
    case "frontend":
    case "disabled":
      return entries.has("handler") ? null : "useRenderTool";
    default:
      if (entries.has("handler")) return "useFrontendTool";
      return entries.has("render") ? "useRenderTool" : null;
  }
}

/** The keys the v1 Vue hook passed to `useHumanInTheLoop`. */
const VUE_WAIT_KEYS = new Set([
  "name",
  "description",
  "parameters",
  "renderAndWaitForResponse",
  "renderAndWait",
  "agentId",
]);

/** The Vue v1 dispatch. */
function vueHook({ entries, availability, waitKey }: ActionConfig) {
  if (waitKey) {
    const keys = [...entries.keys()];
    return keys.every((key) => VUE_WAIT_KEYS.has(key))
      ? "useHumanInTheLoop"
      : null;
  }
  const rendersOnly =
    availability === "frontend" || availability === "disabled";
  if (!rendersOnly) return "useFrontendTool";
  const draws =
    entries.has("render") &&
    entries.has("parameters") &&
    !entries.has("handler");
  return draws ? "useRenderTool" : null;
}

function convertCall(
  call: Node,
  { z, source }: CallContext,
  dialect: ActionDialect,
) {
  const args = argumentNodes(call);
  const [config] = args;
  if (config?.kind() !== "object" || args.length > 2) return null;
  const entries = new Map<string, Node>();
  for (const entry of config.children()) {
    const kind = entry.kind();
    if (["{", "}", ",", "comment"].includes(kind)) continue;
    const key = keyOf(entry);
    if (key === undefined || !dialect.keys.has(key) || entries.has(key)) {
      return null;
    }
    entries.set(key, entry);
  }

  const name = valueOf(entries.get("name"));
  if (!name || (name.kind() === "string" && name.text().slice(1, -1) === "*")) {
    return null;
  }
  const available = valueOf(entries.get("available"));
  if (available === null) return null;
  const availability =
    available === undefined ? undefined : stringLiteral(available);
  if (available !== undefined && availability === undefined) return null;

  const disabledEntry = entries.get("disabled");
  if (disabledEntry && available !== undefined) return null;

  const waitKey = entries.has("renderAndWaitForResponse")
    ? "renderAndWaitForResponse"
    : entries.has("renderAndWait")
      ? "renderAndWait"
      : undefined;
  const hook = dialect.hookFor({ entries, availability, waitKey });
  if (hook === null) return null;

  const edits: Edit[] = [];
  const callee = call.field("function");
  if (!callee) return null;

  // Parameters.
  let usesZod = false;
  const parametersEntry = entries.get("parameters");
  const parameters = valueOf(parametersEntry);
  const indent = indentOf(parametersEntry ?? config, source);
  // A render reads the arguments of a tool the agent defines. Without
  // declared parameters they stay untyped, as in v1.
  const looseRecord = `${z}.record(${z}.string(), ${z}.any())`;
  if (parameters) {
    if (parameters.kind() !== "array") return null;
    const declared = parameters
      .children()
      .some((child) => child.kind() === "object");
    const schema =
      hook === "useRenderTool" && !declared
        ? looseRecord
        : zodObject(parameters, z, indent);
    if (schema === null) return null;
    edits.push(parameters.replace(schema));
    usesZod = true;
  } else if (hook === "useRenderTool") {
    // A named renderer takes a schema.
    const nameEntry = entries.get("name")!;
    edits.push({
      startPos: nameEntry.range().end.index,
      endPos: nameEntry.range().end.index,
      insertedText: `,\n${indentOf(nameEntry, source)}parameters: ${looseRecord}`,
    });
    usesZod = true;
  }

  // `webmcp` is a `useFrontendTool` option only.
  if (entries.has("webmcp") && hook !== "useFrontendTool") return null;

  // `disabled` (deprecated in v1) is `available` negated.
  if (disabledEntry) {
    const value = valueOf(disabledEntry);
    if (!value || disabledEntry.kind() !== "pair") return null;
    if (hook === "useRenderTool") {
      edits.push(removeEntry(disabledEntry, source));
    } else {
      edits.push(disabledEntry.replace(`available: ${negate(value)}`));
    }
  }

  // Availability.
  const availableEntry = entries.get("available");
  if (availableEntry) {
    if (availability === dialect.unavailable && hook !== "useRenderTool") {
      const value = valueOf(availableEntry);
      if (value) edits.push(value.replace("false"));
    } else {
      edits.push(removeEntry(availableEntry, source));
    }
  }

  // Render.
  let render: Node | null | undefined;
  if (waitKey) {
    const entry = entries.get(waitKey)!;
    const key = entry.field("key") ?? entry.field("name");
    if (entry.kind() === "shorthand_property_identifier") {
      edits.push(entry.replace(`render: ${entry.text()}`));
    } else if (key) {
      edits.push(key.replace("render"));
    } else {
      return null;
    }
    render = valueOf(entry);
  } else {
    render = valueOf(entries.get("render"));
  }
  if (render && render.kind() === "string") return null;

  if (hook === "useHumanInTheLoop" && render && dialect.waitRenames) {
    const renamed = renameProps(render, dialect.waitRenames);
    if (renamed === null) return null;
    edits.push(...renamed);
  }

  if (hook === "useRenderTool") {
    if (!render) return null;
    const renamed = renameProps(render, { args: "parameters" });
    if (renamed === null) return null;
    edits.push(...renamed);
    // `useRenderTool` takes no description or follow-up.
    for (const key of ["description", "followUp"]) {
      const entry = entries.get(key);
      if (entry) edits.push(removeEntry(entry, source));
    }
  }

  // The TODO goes in the callee's edit: an insert at the same position as
  // another edit would be dropped.
  let calleeText = hook;
  const statement = call.parent();
  if (
    render &&
    /\bresult\b/.test(render.text()) &&
    statement?.kind() === "expression_statement" &&
    statement.range().start.index === callee.range().start.index
  ) {
    const comment = `// ${TODO} ${dialect.resultNote}`;
    const startChar = charIndex(source, callee.range().start.index);
    const lineStart = source.lastIndexOf("\n", startChar - 1) + 1;
    if (!source.slice(0, lineStart).trimEnd().endsWith(comment)) {
      calleeText = `${comment}\n${source.slice(lineStart, startChar)}${hook}`;
    }
  }
  edits.push(callee.replace(calleeText));

  return { hook, edits, usesZod };
}

/**
 * Renames props a render function reads, by `renames` (v1 name to 2.0
 * name): `useRenderTool` passes the arguments as `parameters`, not `args`.
 * A destructured prop keeps its local name (`{ parameters: args }`).
 * `null` when the function reads its props in a way this does not follow.
 */
function renameProps(
  render: Node,
  renames: Record<string, string>,
): Edit[] | null {
  // A reference to a function declared elsewhere is not followed.
  if (
    !["arrow_function", "function_expression", "function"].includes(
      render.kind(),
    )
  ) {
    return null;
  }
  const parameters = render.field("parameters");
  const first =
    render.field("parameter") ??
    parameters
      ?.children()
      .find((child) =>
        ["required_parameter", "optional_parameter", "identifier"].includes(
          child.kind(),
        ),
      );
  if (!first) return [];
  const pattern =
    first.kind() === "identifier" ? first : (first.field("pattern") ?? first);
  const renamed = (name: string | undefined) =>
    name !== undefined && Object.hasOwn(renames, name)
      ? renames[name]
      : undefined;
  if (pattern.kind() === "object_pattern") {
    const edits: Edit[] = [];
    for (const property of pattern.children()) {
      if (property.kind() === "shorthand_property_identifier_pattern") {
        const to = renamed(property.text());
        if (to) edits.push(property.replace(`${to}: ${property.text()}`));
      } else if (property.kind() === "pair_pattern") {
        const key = property.field("key");
        const to = renamed(key?.text());
        if (key && to) edits.push(key.replace(to));
      } else if (property.kind() === "object_assignment_pattern") {
        const left = property.field("left");
        const to = renamed(left?.text());
        if (left && to) edits.push(left.replace(`${to}: ${left.text()}`));
      } else if (property.kind() === "rest_pattern") {
        return null;
      }
    }
    return edits;
  }
  if (pattern.kind() !== "identifier") return null;
  // `(props) => ... props.args ...`: each use must be a property read.
  const props = pattern.text();
  const body = render.field("body");
  if (!body) return [];
  const uses = body.findAll({
    rule: { kind: "identifier", regex: `^${props}$` },
  });
  const edits: Edit[] = [];
  for (const use of uses) {
    const parent = use.parent();
    if (
      parent?.kind() !== "member_expression" ||
      parent.field("object")?.text() !== props
    ) {
      return null;
    }
    const property = parent.field("property");
    const to = renamed(property?.text());
    if (property && to) edits.push(property.replace(to));
  }
  return edits;
}

/** `!(expression)`, or the operand of an expression that is already `!x`. */
function negate(value: Node): string {
  if (value.kind() === "true") return "false";
  if (value.kind() === "false") return "true";
  if (value.kind() === "unary_expression" && value.text().startsWith("!")) {
    const operand = value.field("argument");
    if (operand) return operand.text();
  }
  return ["identifier", "member_expression", "call_expression"].includes(
    value.kind(),
  )
    ? `!${value.text()}`
    : `!(${value.text()})`;
}

// ---------------------------------------------------------------------------
// Parameter[] to zod, by the rules of v1's getZodParameters

const PARAMETER_KEYS = new Set([
  "name",
  "type",
  "description",
  "required",
  "enum",
  "attributes",
]);
const PRIMITIVES: Record<string, string> = {
  string: "string",
  number: "number",
  boolean: "boolean",
};

function zodObject(array: Node, z: string, indent: string): string | null {
  const items = array
    .children()
    .filter((child) => ![",", "[", "]", "comment"].includes(child.kind()));
  if (items.length === 0) return `${z}.object({})`;
  const lines: string[] = [];
  for (const item of items) {
    if (item.kind() !== "object") return null;
    const fields = new Map<string, Node>();
    for (const entry of item.children()) {
      if (["{", "}", ",", "comment"].includes(entry.kind())) continue;
      if (entry.kind() !== "pair") return null;
      const key = keyOf(entry);
      if (key === undefined || !PARAMETER_KEYS.has(key)) return null;
      const value = entry.field("value");
      if (!value) return null;
      fields.set(key, value);
    }
    const name = fields.get("name");
    if (!name || name.kind() !== "string") return null;
    const schema = zodParameter(fields, z, `${indent}  `);
    if (schema === null) return null;
    lines.push(
      `${indent}  ${propertyKey(name.text().slice(1, -1))}: ${schema},`,
    );
  }
  return `${z}.object({\n${lines.join("\n")}\n${indent}})`;
}

function zodParameter(
  fields: Map<string, Node>,
  z: string,
  indent: string,
): string | null {
  const typeNode = fields.get("type");
  const type = typeNode === undefined ? "string" : stringLiteral(typeNode);
  if (type === undefined) return null;
  const attributes = fields.get("attributes");
  const nested = () => {
    if (!attributes) return `${z}.object({})`;
    if (attributes.kind() !== "array") return null;
    return zodObject(attributes, z, indent);
  };

  let schema: string | null;
  if (type === "string") {
    const values = fields.get("enum");
    if (values && values.kind() !== "array") return null;
    schema = values ? `${z}.enum(${values.text()})` : `${z}.string()`;
  } else if (type === "number" || type === "boolean") {
    schema = `${z}.${type}()`;
  } else if (type === "object") {
    schema = nested();
  } else if (type === "object[]") {
    const item = nested();
    schema = item === null ? null : `${z}.array(${item})`;
  } else if (type.endsWith("[]") && PRIMITIVES[type.slice(0, -2)]) {
    schema = `${z}.array(${z}.${PRIMITIVES[type.slice(0, -2)]}())`;
  } else {
    return null;
  }
  if (schema === null) return null;

  const description = fields.get("description");
  if (description) schema += `.describe(${description.text()})`;
  const required = fields.get("required");
  if (required) {
    if (required.kind() === "false") schema += ".optional()";
    else if (required.kind() !== "true") return null;
  }
  return schema;
}
