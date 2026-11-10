import type { Edit } from "codemod:ast-grep";
import {
  argumentNodes,
  keyOf,
  removeSpecifier,
  valueOf,
} from "./ast-helpers.ts";
import type { Node } from "./ast-helpers.ts";
import { byteIndex, charIndex } from "./offsets.ts";

const GQL_SOURCE = "@copilotkit/runtime-client-gql";
const ROLES: Record<string, string> = {
  User: "user",
  Assistant: "assistant",
  System: "system",
  Developer: "developer",
};

/**
 * Rewrites v1 GraphQL text messages to AG-UI messages, which 2.0 uses
 * everywhere: `new TextMessage({ role: Role.User, content })` becomes
 * `{ id: crypto.randomUUID(), role: "user" as const, content }` (the `id`
 * is kept when given). `TextMessage`, `Role` and `MessageRole` are dropped
 * from the import once nothing uses them, and the import with them when it
 * is empty. A message with another key, or a role that is not a literal
 * `Role.X`, is left for the TODO.
 *
 * Returns the new source, or `null` when nothing changed.
 */
export function migrateGqlMessages(rootNode: Node): string | null {
  const source = rootNode.text();
  if (!source.includes(GQL_SOURCE)) return null;
  const statement = rootNode
    .findAll({ rule: { kind: "import_statement" } })
    .find((node) => node.field("source")?.text().slice(1, -1) === GQL_SOURCE);
  if (!statement) return null;
  const specifiers = statement.findAll({ rule: { kind: "import_specifier" } });
  const localOf = (name: string) => {
    const specifier = specifiers.find((s) => s.field("name")?.text() === name);
    return (
      specifier && (specifier.field("alias") ?? specifier.field("name"))?.text()
    );
  };
  const textMessage = localOf("TextMessage");
  if (!textMessage) return null;
  const roleEnums = new Set(
    [localOf("Role"), localOf("MessageRole")].filter(
      (name): name is string => !!name,
    ),
  );

  const edits: Edit[] = [];
  const constructions = rootNode.findAll({
    rule: {
      kind: "new_expression",
      has: {
        field: "constructor",
        kind: "identifier",
        regex: `^${textMessage}$`,
      },
    },
  });
  for (const construction of constructions) {
    const args = argumentNodes(construction);
    const [config] = args;
    if (config?.kind() !== "object" || args.length !== 1) continue;
    const fields = new Map<string, Node>();
    let supported = true;
    for (const entry of config.children()) {
      if (["{", "}", ",", "comment"].includes(entry.kind())) continue;
      const key = keyOf(entry);
      if (!key || !["role", "content", "id"].includes(key)) supported = false;
      else fields.set(key, entry);
    }
    const role = valueOf(fields.get("role"));
    const content = valueOf(fields.get("content"));
    if (!supported || !role || !content || role.kind() !== "member_expression")
      continue;
    const enumName = role.field("object")?.text();
    const member = role.field("property")?.text();
    const roleText = member !== undefined ? ROLES[member] : undefined;
    if (!enumName || !roleEnums.has(enumName) || !roleText) continue;
    const id = valueOf(fields.get("id"));
    // `{ content }` stays a shorthand.
    const contentEntry =
      fields.get("content")!.kind() === "pair"
        ? `content: ${content.text()}`
        : "content";
    edits.push(
      construction.replace(
        `{ id: ${id ? id.text() : "crypto.randomUUID()"}, role: "${roleText}" as const, ${contentEntry} }`,
      ),
    );
  }
  if (edits.length === 0) return null;

  // Drop the specifiers nothing uses any more.
  const after = rootNode.commitEdits(edits);
  const removed: Edit[] = [];
  for (const name of ["TextMessage", "Role", "MessageRole"]) {
    const specifier = specifiers.find((s) => s.field("name")?.text() === name);
    const local =
      specifier &&
      (specifier.field("alias") ?? specifier.field("name"))?.text();
    if (!specifier || !local) continue;
    const uses = after.match(new RegExp(`\\b${local}\\b`, "g"))?.length ?? 0;
    // The import itself is the one use left.
    if (uses <= 1) removed.push(removeSpecifier(specifier, source));
  }
  // A named-only import whose every specifier goes: delete the import line.
  if (
    removed.length === specifiers.length &&
    /^import\s*\{/.test(statement.text())
  ) {
    const start = charIndex(source, statement.range().start.index);
    let end = charIndex(source, statement.range().end.index);
    if (source[end] === "\n") end++;
    return rootNode.commitEdits([
      ...edits,
      {
        startPos: byteIndex(source, start),
        endPos: byteIndex(source, end),
        insertedText: "",
      },
    ]);
  }
  return rootNode.commitEdits([...edits, ...removed]);
}
