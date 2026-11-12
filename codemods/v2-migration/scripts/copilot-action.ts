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

const TODO = "TODO(copilotkit-2.0):";
const RESULT_NOTE =
  "`result` is the tool's result as a string in 2.0; v1 parsed it as JSON first. Parse it with `JSON.parse` where you need the object. https://docs.copilotkit.ai/reference/v2/hooks/useFrontendTool";

/**
 * Rewrites v1 `useCopilotAction(...)` calls to the 2.0 hook that does the
 * same job, the way v1 itself dispatched them:
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
export function migrateCopilotActions(rootNode: Node): string | null {
  return migrateV1Calls(rootNode, "useCopilotAction", (call, context) => {
    const converted = convertCall(call, context.z, context.source);
    if (!converted) return null;
    if (converted.usesZod) context.useZod();
    return { edits: converted.edits, hooks: [converted.hook] };
  });
}

interface Converted {
  hook: string;
  edits: Edit[];
  usesZod: boolean;
}

const ACTION_KEYS = new Set([
  "name",
  "description",
  "parameters",
  "handler",
  "render",
  "renderAndWaitForResponse",
  "renderAndWait",
  "followUp",
  "available",
  "disabled",
  "webmcp",
]);

function convertCall(call: Node, z: string, source: string): Converted | null {
  const args = argumentNodes(call);
  const [config] = args;
  if (config?.kind() !== "object" || args.length > 2) return null;
  const entries = new Map<string, Node>();
  for (const entry of config.children()) {
    const kind = entry.kind();
    if (["{", "}", ",", "comment"].includes(kind)) continue;
    const key = keyOf(entry);
    if (key === undefined || !ACTION_KEYS.has(key) || entries.has(key)) {
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
  let hook: string;
  if (waitKey) {
    if (entries.has("render") || entries.has("handler")) return null;
    if (availability === "frontend") return null;
    hook = "useHumanInTheLoop";
  } else if (availability === "enabled" || availability === "remote") {
    hook = "useFrontendTool";
  } else if (availability === "frontend" || availability === "disabled") {
    if (entries.has("handler")) return null;
    hook = "useRenderTool";
  } else if (entries.has("handler")) {
    hook = "useFrontendTool";
  } else if (entries.has("render")) {
    hook = "useRenderTool";
  } else {
    return null;
  }

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
    if (availability === "disabled" && hook !== "useRenderTool") {
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

  // HITL: v1 passed the respond callback as `handler` too.
  if (hook === "useHumanInTheLoop" && render) {
    const renamed = renameProps(render, { handler: "respond" });
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
    const comment = `// ${TODO} ${RESULT_NOTE}`;
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
