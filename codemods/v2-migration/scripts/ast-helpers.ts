import type { Edit, SgNode } from "codemod:ast-grep";
import type TS from "codemod:ast-grep/langs/typescript";
import type TSX from "codemod:ast-grep/langs/tsx";
import { charIndex } from "./offsets.ts";

/** AST helpers shared by the passes that rewrite v1 calls. */

export type Node = SgNode<TS | TSX>;

export function argumentNodes(call: Node): Node[] {
  return (call.field("arguments")?.children() ?? []).filter(
    (child) => !["(", ")", ",", "comment"].includes(child.kind()),
  );
}

export function keyOf(entry: Node): string | undefined {
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
export function valueOf(entry: Node | undefined): Node | null | undefined {
  if (!entry) return undefined;
  if (entry.kind() === "pair") return entry.field("value");
  return entry;
}

export function stringLiteral(node: Node): string | undefined {
  if (node.kind() !== "string") return undefined;
  const text = node.text();
  return text.slice(1, -1);
}

export function propertyKey(name: string) {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

/** The indentation of the line `node` starts on. */
export function indentOf(node: Node, source: string) {
  const start = charIndex(source, node.range().start.index);
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  return /^[ \t]*/.exec(source.slice(lineStart, start))?.[0] ?? "";
}

/**
 * Deletes an object entry with its comma: the comma after it, or, for the
 * last entry, the comma before it.
 */
export function removeEntry(entry: Node, source: string): Edit {
  const startChar = charIndex(source, entry.range().start.index);
  const endChar = charIndex(source, entry.range().end.index);
  const after = /^[ \t]*,[ \t]*(\/\/[^\n]*)?\n?/.exec(source.slice(endChar));
  if (after) {
    let start = startChar;
    while (start > 0 && /[ \t]/.test(source[start - 1]!)) start--;
    return {
      startPos: entry.range().start.index - (startChar - start),
      endPos:
        entry.range().end.index +
        byteLength(source.slice(endChar, endChar + after[0].length)),
      insertedText: "",
    };
  }
  // The last entry: take the comma before it, and keep what follows.
  const before = /,\s*$/.exec(source.slice(0, startChar));
  const start = before ? startChar - before[0].length : startChar;
  return {
    startPos:
      entry.range().start.index - byteLength(source.slice(start, startChar)),
    endPos: entry.range().end.index,
    insertedText: "",
  };
}

/** Deletes an import specifier with its comma. */
export function removeSpecifier(specifier: Node, source: string): Edit {
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

export function byteLength(text: string) {
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
export function zodBinding(rootNode: Node): string | undefined {
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
