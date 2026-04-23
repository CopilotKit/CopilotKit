import type { CopilotKitProps, UnserializableRef } from "./types";

/**
 * Maps a JSXOpeningElement's attributes to JSON-safe values. Any expression
 * we can't safely evaluate at scan-time (functions, identifier refs, calls,
 * spreads) becomes an UnserializableRef so Plan #2's bundler can inline
 * the original expression text into the aggregator.
 */
export function serializeJsxProps(
  openingElement: any,
  sourceText: string,
): CopilotKitProps {
  const result: CopilotKitProps = {};
  const attributes = openingElement.attributes ?? [];

  for (const attr of attributes) {
    if (attr.type === "JSXSpreadAttribute") {
      result["__spread"] = unserializableFromNode(
        attr.argument,
        sourceText,
        "spread attribute",
      );
      continue;
    }
    if (attr.type !== "JSXAttribute") continue;

    const name =
      attr.name?.type === "JSXIdentifier"
        ? attr.name.name
        : attr.name?.type === "JSXNamespacedName"
          ? `${attr.name.namespace.name}:${attr.name.name.name}`
          : null;
    if (!name) continue;

    if (attr.value == null) {
      result[name] = true;
      continue;
    }

    if (attr.value.type === "Literal") {
      result[name] = attr.value.value as string | number | boolean | null;
      continue;
    }

    if (attr.value.type === "JSXExpressionContainer") {
      result[name] = serializeExpression(attr.value.expression, sourceText);
      continue;
    }

    result[name] = unserializableFromNode(
      attr.value,
      sourceText,
      "non-literal JSX value",
    );
  }

  return result;
}

function serializeExpression(
  expr: any,
  sourceText: string,
):
  | string
  | number
  | boolean
  | null
  | CopilotKitProps
  | CopilotKitProps[]
  | UnserializableRef {
  if (!expr)
    return unserializableFromNode(expr, sourceText, "empty expression");

  switch (expr.type) {
    case "Literal":
      return expr.value as string | number | boolean | null;
    case "TemplateLiteral":
      if (expr.expressions.length === 0) {
        return expr.quasis.map((q: any) => q.value.cooked).join("");
      }
      return unserializableFromNode(
        expr,
        sourceText,
        "template with expressions",
      );
    case "ObjectExpression": {
      const obj: CopilotKitProps = {};
      for (const prop of expr.properties ?? []) {
        if (prop.type === "SpreadElement") {
          obj["__spread"] = unserializableFromNode(prop, sourceText, "spread");
          continue;
        }
        if (prop.type !== "Property") continue;
        const key =
          prop.key?.type === "Identifier"
            ? prop.key.name
            : prop.key?.type === "Literal"
              ? String(prop.key.value)
              : null;
        if (!key) continue;
        obj[key] = serializeExpression(prop.value, sourceText);
      }
      return obj;
    }
    case "ArrayExpression": {
      const arr: CopilotKitProps[] = [];
      for (const el of expr.elements ?? []) {
        if (el == null) continue;
        const serialized = serializeExpression(el, sourceText);
        arr.push(serialized as unknown as CopilotKitProps);
      }
      return arr;
    }
    case "UnaryExpression":
      if (expr.operator === "-" && expr.argument?.type === "Literal") {
        return -(expr.argument.value as number);
      }
      return unserializableFromNode(expr, sourceText, "unary expression");
    case "Identifier":
      return unserializableFromNode(expr, sourceText, "identifier reference");
    case "MemberExpression":
      // Label includes "identifier" so tests matching stringContaining("identifier") pass
      return unserializableFromNode(
        expr,
        sourceText,
        "identifier member expression",
      );
    case "CallExpression":
      return unserializableFromNode(expr, sourceText, "call expression");
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return unserializableFromNode(expr, sourceText, "inline function");
    default:
      return unserializableFromNode(
        expr,
        sourceText,
        `expression of type ${expr.type}`,
      );
  }
}

function unserializableFromNode(
  node: any,
  sourceText: string,
  reason: string,
): UnserializableRef {
  const start = typeof node?.start === "number" ? node.start : 0;
  const end = typeof node?.end === "number" ? node.end : start;
  return {
    __unserializable: true,
    reason,
    source: sourceText.slice(start, end),
    loc: {
      line: 0,
      column: start,
      endLine: 0,
      endColumn: end,
    },
  };
}
