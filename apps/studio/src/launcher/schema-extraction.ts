/**
 * Static schema extraction from a hook's `parameters` argument.
 *
 * Handles two shapes that show up in real CopilotKit user code:
 *
 *   - **v1 array literals** — `useCopilotAction({ parameters: [{ name: "x",
 *     type: "string", required: true, attributes: [...] }, ...] })`.
 *     This is how `useCopilotAction` is documented today, so the bulk of
 *     existing code uses it.
 *
 *   - **v2 Zod calls** — `useFrontendTool({ parameters: z.object({ x:
 *     z.string(), y: z.number().optional() }) })`. The v2 hooks accept any
 *     Standard Schema; in practice nearly every example uses Zod literally.
 *
 * Falls back to `type: "opaque"` for anything we can't statically resolve:
 * builder functions (`buildSchema()`), spread imports, identifier references,
 * or unsupported Zod combinators. The form renderer (M4) drops to a JSON
 * editor for opaque parameters.
 *
 * **Never throws.** Static analysis edge cases collapse into "opaque",
 * because the scanner walks user code that the launcher cannot assume is
 * well-formed.
 *
 * The AST shape here is oxc-parser's; oxc emits ES2022 plus TS extensions.
 * Identifier-vs-Literal distinctions match estree. The `any` typing matches
 * the upstream reference scanner — oxc's type definitions are intentionally
 * loose at this layer.
 */
import type { ParameterDescriptor } from "../shared/types.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AstNode = any;

/**
 * The shape produced by the type-mapping helpers — always has a `type`,
 * plus the type-specific fields (`enumValues`, `itemType`, `properties`).
 * `name`, `required`, `description` are populated by callers.
 */
type ParameterShape = Pick<ParameterDescriptor, "type"> &
  Partial<Pick<ParameterDescriptor, "enumValues" | "itemType" | "properties">>;

/**
 * Extract parameter descriptors from the `parameters:` value of an
 * `ObjectExpression`. Returns `[]` when no `parameters` key is present,
 * which is a valid case (a hook with no args).
 */
export function extractParameters(
  configObject: AstNode | null | undefined,
): ParameterDescriptor[] {
  if (!configObject || configObject.type !== "ObjectExpression") return [];
  const parametersProp = findProperty(configObject, "parameters");
  if (!parametersProp) return [];

  const value = parametersProp.value;
  if (!value) return [];

  // v1: parameters: [{ name, type, required, ... }, ...]
  if (value.type === "ArrayExpression") {
    return extractV1Parameters(value);
  }

  // v2: parameters: z.object({ ... }) (or `.passthrough()`, `.strict()`, etc.)
  if (value.type === "CallExpression") {
    return extractZodObjectAsParameters(value);
  }

  // Anything else (Identifier, MemberExpression, function call we don't
  // recognise) → single opaque parameter so the form falls back to JSON.
  return opaqueRootParameters();
}

/**
 * Extract the description literal from a hook config object's
 * `description:` key. Returns `undefined` when missing or non-literal.
 */
export function extractDescription(
  configObject: AstNode | null | undefined,
): string | undefined {
  if (!configObject || configObject.type !== "ObjectExpression")
    return undefined;
  const prop = findProperty(configObject, "description");
  if (!prop) return undefined;
  return readStringLiteral(prop.value) ?? undefined;
}

/**
 * Extract the `name:` literal. Returns `null` when the name can't be
 * statically resolved (dynamic identifier, computed key, template expression).
 */
export function extractName(
  configObject: AstNode | null | undefined,
): string | null {
  if (!configObject || configObject.type !== "ObjectExpression") return null;
  const prop = findProperty(configObject, "name");
  if (!prop) return null;
  const v = readStringLiteral(prop.value);
  return v ?? null;
}

// ---------------------------------------------------------------------------
// v1: `parameters: [{...}, ...]`
// ---------------------------------------------------------------------------

function extractV1Parameters(arrayNode: AstNode): ParameterDescriptor[] {
  const out: ParameterDescriptor[] = [];
  for (const element of arrayNode.elements ?? []) {
    if (!element || element.type !== "ObjectExpression") continue;
    const descriptor = v1ParameterFromObject(element);
    if (descriptor) out.push(descriptor);
  }
  return out;
}

function v1ParameterFromObject(node: AstNode): ParameterDescriptor | null {
  const name = readStringLiteral(findProperty(node, "name")?.value);
  if (!name) return null;

  const typeLiteral = readStringLiteral(findProperty(node, "type")?.value);
  const required = readBooleanLiteral(findProperty(node, "required")?.value);
  const description = readStringLiteral(
    findProperty(node, "description")?.value,
  );
  const enumProp = findProperty(node, "enum")?.value;
  const enumValues =
    enumProp?.type === "ArrayExpression"
      ? readStringLiteralArray(enumProp)
      : null;
  const attributesNode = findProperty(node, "attributes")?.value;

  const base: ParameterDescriptor = {
    name,
    // v1 defaults `required` to true when omitted — matches the actions SDK
    // behavior in `@copilotkit/runtime`.
    required: required ?? true,
    ...(description ? { description } : {}),
    ...mapV1Type(typeLiteral, attributesNode, enumValues),
  };
  return base;
}

/**
 * Map a v1 `type: "..."` literal onto a `ParameterDescriptor` `type` plus
 * any nested shape it implies. Handles:
 *   - "string" | "number" | "boolean"
 *   - "object" with `attributes: [...]` → recurse
 *   - "string[]" | "object[]" | "<type>[]" → array w/ recursive item type
 *   - enum (regardless of `type`) when `enum: [...]` is present and strings
 *   - anything else → opaque
 */
function mapV1Type(
  typeLiteral: string | null | undefined,
  attributesNode: AstNode | null | undefined,
  enumValues: string[] | null,
): ParameterShape {
  // Enums take precedence — a string enum is still an enum, not a free string.
  if (enumValues && enumValues.length > 0) {
    return { type: "enum", enumValues };
  }

  if (!typeLiteral) {
    return { type: "opaque" };
  }

  if (typeLiteral === "string") return { type: "string" };
  if (typeLiteral === "number") return { type: "number" };
  if (typeLiteral === "boolean") return { type: "boolean" };

  if (typeLiteral === "object") {
    return {
      type: "object",
      properties: extractV1AttributeProperties(attributesNode),
    };
  }

  // `type: "object[]"` / `type: "string[]"` / `type: "<x>[]"`.
  if (typeLiteral.endsWith("[]")) {
    const inner = typeLiteral.slice(0, -2);
    const itemType = innerV1Type(inner, attributesNode);
    return { type: "array", itemType };
  }

  return { type: "opaque" };
}

function innerV1Type(
  innerLiteral: string,
  attributesNode: AstNode | null | undefined,
): ParameterDescriptor {
  // Synthetic item descriptor — name "item" is a convention matching the
  // upstream form renderer in vscode-extension/src/webview/.../v1-params.ts.
  const inner = mapV1Type(innerLiteral, attributesNode, null);
  return {
    name: "item",
    required: true,
    ...inner,
  };
}

function extractV1AttributeProperties(
  attributesNode: AstNode | null | undefined,
): ParameterDescriptor[] {
  if (!attributesNode || attributesNode.type !== "ArrayExpression") return [];
  const out: ParameterDescriptor[] = [];
  for (const element of attributesNode.elements ?? []) {
    if (!element || element.type !== "ObjectExpression") continue;
    const desc = v1ParameterFromObject(element);
    if (desc) out.push(desc);
  }
  return out;
}

// ---------------------------------------------------------------------------
// v2: `parameters: z.object({ ... })`
// ---------------------------------------------------------------------------

/**
 * Walks a `z.object({...})` call expression and synthesizes
 * `ParameterDescriptor[]` from its top-level shape.
 *
 * Supported per-field combinators:
 *   - z.string() / z.number() / z.boolean()
 *   - z.enum(["a", "b", "c"]) — string enum literals only
 *   - z.array(<inner>) — single-level recursion into the inner type
 *   - z.object({...}) — recurse
 *   - .optional() / .nullable() / .nullish() — strips required = false
 *   - .describe("...") — extracts description; preserves underlying type
 *
 * Anything we don't recognize (z.union, z.lazy, z.discriminatedUnion, custom
 * refinements, identifier references, runtime-built schemas) collapses to
 * `type: "opaque"` for that field. The whole tree never crashes on weird
 * input — that's the static analysis contract.
 */
function extractZodObjectAsParameters(
  callExpr: AstNode,
): ParameterDescriptor[] {
  const zObject = unwrapToZodObjectCall(callExpr);
  if (!zObject) return opaqueRootParameters();

  const shapeArg = zObject.arguments?.[0];
  if (!shapeArg || shapeArg.type !== "ObjectExpression") {
    return opaqueRootParameters();
  }

  const out: ParameterDescriptor[] = [];
  for (const prop of shapeArg.properties ?? []) {
    if (!prop || prop.type !== "Property") continue;
    if (prop.computed) continue;
    const key = readPropertyKeyName(prop.key);
    if (!key) continue;
    const desc = zodValueToDescriptor(key, prop.value);
    out.push(desc);
  }
  return out;
}

/**
 * Walks .optional() / .nullable() / .nullish() / .describe() chains backward
 * to find the underlying call to `z.object(...)`. Returns null if the
 * chain doesn't terminate there.
 */
function unwrapToZodObjectCall(node: AstNode): AstNode | null {
  let current: AstNode | null = node;
  // Bounded loop — well-formed Zod chains are tiny in practice, but a
  // pathological AST shouldn't be able to spin forever.
  for (let i = 0; i < 30 && current; i++) {
    if (current.type !== "CallExpression") return null;
    const callee = current.callee;
    if (callee?.type === "Identifier") {
      // bare `object(...)` — only matches when the user imported `object`
      // from `zod` directly. Treat as the terminal anchor.
      if (callee.name === "object") return current;
      return null;
    }
    if (callee?.type !== "MemberExpression") return null;
    const propName = readMemberPropertyName(callee.property);
    if (!propName) return null;

    // Terminal anchor: z.object(...).
    if (
      propName === "object" &&
      callee.object?.type === "Identifier" &&
      isZNamespace(callee.object.name)
    ) {
      return current;
    }

    // Chain step on an object schema: `z.object({...}).passthrough()`,
    // `.strict()`, `.describe("...")`, `.optional()`, etc. We continue
    // walking into the receiver.
    current = callee.object as AstNode;
  }
  return null;
}

/**
 * Convert a Zod-call expression representing a single field value into a
 * ParameterDescriptor with `name = key`. Handles wrappers (.optional(),
 * .describe(...)) and a fixed set of leaf types.
 */
function zodValueToDescriptor(
  key: string,
  value: AstNode | null | undefined,
): ParameterDescriptor {
  if (!value) return { name: key, type: "opaque", required: true };

  // Peel wrappers off until we hit a leaf-like call. Track `optional` and
  // `description` as we go.
  let cursor: AstNode = value;
  let required = true;
  let description: string | undefined;

  for (let i = 0; i < 30; i++) {
    if (cursor?.type !== "CallExpression") break;
    const callee = cursor.callee;
    if (callee?.type !== "MemberExpression") break;
    const methodName = readMemberPropertyName(callee.property);
    if (!methodName) break;

    if (
      methodName === "optional" ||
      methodName === "nullable" ||
      methodName === "nullish"
    ) {
      required = false;
      cursor = callee.object;
      continue;
    }
    if (methodName === "describe") {
      const firstArg = cursor.arguments?.[0];
      const literal = readStringLiteral(firstArg);
      if (literal && description === undefined) description = literal;
      cursor = callee.object;
      continue;
    }

    // Passthrough wrappers we shouldn't strip but also shouldn't change the
    // type — break and let the leaf detector handle the wrapper as-is.
    if (
      methodName === "default" ||
      methodName === "catch" ||
      methodName === "readonly" ||
      methodName === "brand"
    ) {
      cursor = callee.object;
      continue;
    }

    break;
  }

  // Leaf type detection. After unwrapping, `cursor` is either a Zod leaf
  // call (z.string(), z.number(), z.enum([...]), z.object({...}), z.array(...))
  // or something we don't statically know how to read.
  const leaf = readZodLeaf(cursor);
  const merged: ParameterDescriptor = {
    name: key,
    required,
    ...(description ? { description } : {}),
    ...leaf,
  };
  return merged;
}

/**
 * Inspect a Zod call expression and produce the `type`-and-friends fields of
 * a ParameterDescriptor (without `name`/`required`/`description` — those are
 * assigned by the caller).
 */
function readZodLeaf(node: AstNode): ParameterShape {
  if (!node || node.type !== "CallExpression") return { type: "opaque" };
  const callee = node.callee;

  // Bare identifier (e.g. `string()` imported directly) — unusual, but
  // handle it gracefully.
  if (callee?.type === "Identifier") {
    const name = callee.name as string;
    return mapZodLeafByName(name, node);
  }
  if (callee?.type !== "MemberExpression") return { type: "opaque" };
  const methodName = readMemberPropertyName(callee.property);
  if (!methodName) return { type: "opaque" };

  // Sanity-check: the receiver is the `z` namespace identifier. We tolerate
  // any identifier so users can `import * as zz from "zod"`.
  // (For nested types we recurse; the namespace check matters only at the
  // top — past that, we're chaining methods like .min().max(), which we
  // already stripped above.)
  return mapZodLeafByName(methodName, node);
}

function mapZodLeafByName(
  methodName: string,
  callNode: AstNode,
): ParameterShape {
  switch (methodName) {
    case "string":
    case "uuid":
    case "url":
    case "email":
      return { type: "string" };
    case "number":
    case "int":
    case "bigint":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "enum": {
      const arg = callNode.arguments?.[0];
      const values =
        arg?.type === "ArrayExpression" ? readStringLiteralArray(arg) : null;
      if (values && values.length > 0) {
        return { type: "enum", enumValues: values };
      }
      return { type: "opaque" };
    }
    case "literal": {
      const arg = callNode.arguments?.[0];
      const literal = readStringLiteral(arg);
      if (literal !== null) return { type: "enum", enumValues: [literal] };
      return { type: "opaque" };
    }
    case "array": {
      const inner = callNode.arguments?.[0];
      const itemPartial = readZodLeaf(inner);
      const itemType: ParameterDescriptor = {
        name: "item",
        required: true,
        ...itemPartial,
      };
      return { type: "array", itemType };
    }
    case "object": {
      const shapeArg = callNode.arguments?.[0];
      if (shapeArg?.type !== "ObjectExpression") return { type: "opaque" };
      const properties: ParameterDescriptor[] = [];
      for (const prop of shapeArg.properties ?? []) {
        if (!prop || prop.type !== "Property") continue;
        if (prop.computed) continue;
        const key = readPropertyKeyName(prop.key);
        if (!key) continue;
        properties.push(zodValueToDescriptor(key, prop.value));
      }
      return { type: "object", properties };
    }
    default:
      return { type: "opaque" };
  }
}

function isZNamespace(name: string): boolean {
  // `z`, `Z`, `zz` (aliased imports). The static check is permissive on
  // purpose; the only way to be wrong is to detect a non-Zod `object()`
  // call as Zod, and the downstream descriptor consumers all tolerate
  // shaped-like-Zod-but-not.
  if (name === "z" || name === "Z") return true;
  // Allow short single-word aliases — `zod` itself, or `zz`. Bare
  // `object()` calls without a namespace already hit a different branch.
  return name.length <= 5 && /^[zZ]/.test(name);
}

// ---------------------------------------------------------------------------
// Shared AST helpers
// ---------------------------------------------------------------------------

function findProperty(
  objectExpr: AstNode | null | undefined,
  key: string,
): AstNode | null {
  if (!objectExpr || objectExpr.type !== "ObjectExpression") return null;
  for (const prop of objectExpr.properties ?? []) {
    if (!prop || prop.type !== "Property") continue;
    if (prop.computed) continue;
    const keyName = readPropertyKeyName(prop.key);
    if (keyName === key) return prop;
  }
  return null;
}

function readPropertyKeyName(
  keyNode: AstNode | null | undefined,
): string | null {
  if (!keyNode) return null;
  if (keyNode.type === "Identifier" && typeof keyNode.name === "string") {
    return keyNode.name;
  }
  if (keyNode.type === "Literal" && typeof keyNode.value === "string") {
    return keyNode.value;
  }
  // oxc emits "StringLiteral" in some node shapes too.
  if (keyNode.type === "StringLiteral" && typeof keyNode.value === "string") {
    return keyNode.value;
  }
  return null;
}

function readMemberPropertyName(
  propertyNode: AstNode | null | undefined,
): string | null {
  // `obj.foo` → property is Identifier "foo"; `obj["foo"]` → Literal "foo".
  if (!propertyNode) return null;
  if (
    propertyNode.type === "Identifier" &&
    typeof propertyNode.name === "string"
  ) {
    return propertyNode.name;
  }
  if (
    propertyNode.type === "Literal" &&
    typeof propertyNode.value === "string"
  ) {
    return propertyNode.value;
  }
  if (
    propertyNode.type === "StringLiteral" &&
    typeof propertyNode.value === "string"
  ) {
    return propertyNode.value;
  }
  return null;
}

function readStringLiteral(node: AstNode | null | undefined): string | null {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "StringLiteral" && typeof node.value === "string") {
    return node.value;
  }
  // Allow a single-expression template literal as a string (no
  // interpolation): `\`foo\``.
  if (
    node.type === "TemplateLiteral" &&
    Array.isArray(node.expressions) &&
    node.expressions.length === 0 &&
    Array.isArray(node.quasis) &&
    node.quasis.length === 1
  ) {
    const raw = node.quasis[0]?.value?.cooked;
    if (typeof raw === "string") return raw;
  }
  return null;
}

function readBooleanLiteral(node: AstNode | null | undefined): boolean | null {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "boolean") {
    return node.value;
  }
  if (node.type === "BooleanLiteral" && typeof node.value === "boolean") {
    return node.value;
  }
  return null;
}

function readStringLiteralArray(
  arrayNode: AstNode | null | undefined,
): string[] | null {
  if (!arrayNode || arrayNode.type !== "ArrayExpression") return null;
  const out: string[] = [];
  for (const el of arrayNode.elements ?? []) {
    const value = readStringLiteral(el);
    if (value === null) return null;
    out.push(value);
  }
  return out;
}

function opaqueRootParameters(): ParameterDescriptor[] {
  // We could return [] here, but the form renderer needs *something* to drop
  // into JSON-editor fallback. A single opaque "args" parameter does that.
  return [
    {
      name: "args",
      type: "opaque",
      required: true,
    },
  ];
}
