import type { Edit, SgNode } from "codemod:ast-grep";
import type TS from "codemod:ast-grep/langs/typescript";
import type TSX from "codemod:ast-grep/langs/tsx";
import { charIndex } from "./offsets.ts";

type Node = SgNode<TS | TSX>;

const TODO = "TODO(copilotkit-2.0):";
const V1_SOURCE = "@copilotkit/react-core";
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
  const source = rootNode.text();
  if (!source.includes("useCopilotAction")) return null;
  const imports = rootNode
    .findAll({ rule: { kind: "import_statement" } })
    .filter((statement) => {
      const from = statement.field("source")?.text().slice(1, -1);
      return from === V1_SOURCE;
    });
  const specifiers = imports.flatMap((statement) =>
    statement
      .findAll({ rule: { kind: "import_specifier" } })
      .filter(
        (specifier) => specifier.field("name")?.text() === "useCopilotAction",
      )
      .map((specifier) => ({ statement, specifier })),
  );
  // An aliased import, or a type-only one, is left alone.
  const plain = specifiers.filter(
    ({ specifier }) =>
      !specifier.field("alias") && !/^type\s/.test(specifier.text()),
  );
  if (plain.length !== 1) return null;

  const zod = zodBinding(rootNode);
  const z = zod ?? "z";
  const edits: Edit[] = [];
  const hooks = new Set<string>();
  let usesZod = false;
  let left = 0;

  const calls = rootNode.findAll({
    rule: {
      kind: "call_expression",
      has: {
        field: "function",
        kind: "identifier",
        regex: "^useCopilotAction$",
      },
    },
  });
  for (const call of calls) {
    const converted = convertCall(call, z, source);
    if (!converted) {
      left++;
      continue;
    }
    edits.push(...converted.edits);
    hooks.add(converted.hook);
    usesZod ||= converted.usesZod;
  }
  if (hooks.size === 0) return null;

  // The import: the new hooks in place of `useCopilotAction`, which stays
  // while a call of it is left.
  const { statement, specifier } = plain[0]!;
  const imported = new Set(
    statement
      .findAll({ rule: { kind: "import_specifier" } })
      .map((other: Node) => other.field("name")?.text()),
  );
  const added = [...hooks].filter((hook) => !imported.has(hook));
  const names = left > 0 ? ["useCopilotAction", ...added] : added;
  if (names.length === 0) {
    edits.push(removeSpecifier(specifier, source));
  } else {
    edits.push(specifier.replace(names.join(", ")));
  }

  if (usesZod && zod === undefined) edits.push(zodImport(rootNode, source));
  return rootNode.commitEdits(edits);
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
  if (parameters) {
    if (parameters.kind() !== "array") return null;
    const schema = zodObject(parameters, z, indent);
    if (schema === null) return null;
    edits.push(parameters.replace(schema));
    usesZod = true;
  } else if (hook === "useRenderTool") {
    // A named renderer takes a schema. With no parameters the render reads
    // the arguments of a tool the agent defines, untyped as in v1.
    const nameEntry = entries.get("name")!;
    edits.push({
      startPos: nameEntry.range().end.index,
      endPos: nameEntry.range().end.index,
      insertedText: `,\n${indentOf(nameEntry, source)}parameters: ${z}.record(${z}.string(), ${z}.any())`,
    });
    usesZod = true;
  }

  // 2.0 types a handler as returning a promise; v1 also took sync ones.
  if (hook === "useFrontendTool") {
    const handler = entries.get("handler");
    if (handler) {
      const edit = asyncHandler(handler);
      if (edit === null) return null;
      if (edit) edits.push(edit);
    }
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
 * Makes a sync handler async: `async` before an inline function, or an async
 * wrapper around a reference. `undefined` when it is async already, `null`
 * when it is an expression this does not rewrite (such as a hook call).
 */
function asyncHandler(entry: Node): Edit | null | undefined {
  const isAsync = (node: Node) => /^async\b/.test(node.text());
  if (entry.kind() === "method_definition") {
    if (isAsync(entry) || entry.text().startsWith("*")) return undefined;
    const start = entry.range().start.index;
    return { startPos: start, endPos: start, insertedText: "async " };
  }
  if (entry.kind() === "shorthand_property_identifier") {
    return entry.replace(`handler: async (args) => ${entry.text()}(args)`);
  }
  const value = entry.field("value");
  if (!value) return null;
  switch (value.kind()) {
    case "arrow_function":
    case "function_expression":
    case "function": {
      if (isAsync(value)) return undefined;
      const start = value.range().start.index;
      return { startPos: start, endPos: start, insertedText: "async " };
    }
    case "identifier":
    case "member_expression":
      return value.replace(`async (args) => ${value.text()}(args)`);
    default:
      return null;
  }
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

// ---------------------------------------------------------------------------
// Helpers

function argumentNodes(call: Node): Node[] {
  return (call.field("arguments")?.children() ?? []).filter(
    (child) => !["(", ")", ",", "comment"].includes(child.kind()),
  );
}

function keyOf(entry: Node): string | undefined {
  switch (entry.kind()) {
    case "pair":
    case "method_definition": {
      const key = entry.field("key") ?? entry.field("name");
      if (!key) return undefined;
      return key.kind() === "string" ? key.text().slice(1, -1) : key.text();
    }
    case "shorthand_property_identifier":
      return entry.text();
    default:
      return undefined;
  }
}

/** The value of an entry: the pair's value, the shorthand itself, or the method. */
function valueOf(entry: Node | undefined): Node | null | undefined {
  if (!entry) return undefined;
  if (entry.kind() === "pair") return entry.field("value");
  return entry;
}

function stringLiteral(node: Node): string | undefined {
  if (node.kind() !== "string") return undefined;
  const text = node.text();
  return text.slice(1, -1);
}

function propertyKey(name: string) {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

/** The indentation of the line `node` starts on. */
function indentOf(node: Node, source: string) {
  const start = charIndex(source, node.range().start.index);
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  return /^[ \t]*/.exec(source.slice(lineStart, start))?.[0] ?? "";
}

/** Deletes an object entry with its comma. */
function removeEntry(entry: Node, source: string): Edit {
  const startChar = charIndex(source, entry.range().start.index);
  const endChar = charIndex(source, entry.range().end.index);
  let end = endChar;
  const after = /^[ \t]*,?[ \t]*(\/\/[^\n]*)?\n?/.exec(source.slice(end));
  if (after) end += after[0].length;
  let start = startChar;
  while (start > 0 && /[ \t]/.test(source[start - 1]!)) start--;
  return {
    startPos: entry.range().start.index - (startChar - start),
    endPos: entry.range().end.index + byteLength(source.slice(endChar, end)),
    insertedText: "",
  };
}

/** Deletes an import specifier with its comma. */
function removeSpecifier(specifier: Node, source: string): Edit {
  const endChar = charIndex(source, specifier.range().end.index);
  const comma = /^\s*,/.exec(source.slice(endChar));
  return {
    startPos: specifier.range().start.index,
    endPos:
      specifier.range().end.index +
      (comma
        ? byteLength(source.slice(endChar, endChar + comma[0].length))
        : 0),
    insertedText: "",
  };
}

function byteLength(text: string) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** The name `zod` is imported under (`z` from `import { z }` or `* as z`). */
function zodBinding(rootNode: Node): string | undefined {
  for (const statement of rootNode.findAll({
    rule: { kind: "import_statement" },
  })) {
    const from = statement.field("source")?.text().slice(1, -1);
    if (from !== "zod" && from !== "zod/v4") continue;
    if (/^import\s+type\b/.test(statement.text())) continue;
    const namespace = statement.find({ rule: { kind: "namespace_import" } });
    if (namespace)
      return namespace.find({ rule: { kind: "identifier" } })?.text();
    for (const specifier of statement.findAll({
      rule: { kind: "import_specifier" },
    })) {
      if (
        specifier.field("name")?.text() === "z" &&
        !/^type\s/.test(specifier.text())
      ) {
        return (specifier.field("alias") ?? specifier.field("name"))?.text();
      }
    }
  }
  return undefined;
}

/** `import { z } from "zod";` after the last import of the file. */
function zodImport(rootNode: Node, source: string): Edit {
  const imports = rootNode.findAll({ rule: { kind: "import_statement" } });
  const last = imports[imports.length - 1];
  if (!last) {
    return {
      startPos: 0,
      endPos: 0,
      insertedText: 'import { z } from "zod";\n',
    };
  }
  const end = last.range().end.index;
  return source[charIndex(source, end)] === "\n"
    ? {
        startPos: end + 1,
        endPos: end + 1,
        insertedText: 'import { z } from "zod";\n',
      }
    : {
        startPos: end,
        endPos: end,
        insertedText: '\nimport { z } from "zod";',
      };
}
