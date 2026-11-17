import type { Codemod, Edit, SgNode } from "codemod:ast-grep";
import type HTML from "codemod:ast-grep/langs/html";
import { migrateSource } from "./codemod.ts";

type Node = SgNode<HTML>;

/**
 * The grammar `migrateSource` reads a script block with, by the block's
 * `lang`. It matches workflow.yaml: TypeScript for `ts`, and TSX for `tsx` and
 * for JavaScript (no `lang`, `js` or `jsx`). `null` for any other language,
 * which the codemod does not read.
 */
function grammarOf(lang: string) {
  switch (lang) {
    case "ts":
      return { language: "typescript", jsx: false };
    case "tsx":
    case "jsx":
    case "js":
    case "":
      return { language: "tsx", jsx: true };
    default:
      return null;
  }
}

/** The attributes of a start tag, by name. An attribute with no value has "". */
function attributesOf(startTag: Node) {
  const attributes = new Map<string, string>();
  const nodes = startTag.findAll({ rule: { kind: "attribute" } });
  for (const attribute of nodes) {
    const name = attribute.find({ rule: { kind: "attribute_name" } });
    if (!name) continue;
    const value = attribute.find({ rule: { kind: "attribute_value" } });
    attributes.set(name.text(), value?.text() ?? "");
  }
  return attributes;
}

/**
 * The codemod entry for Vue single-file components (`.vue`, read with the
 * html grammar). It migrates the code of each top-level `<script>` and
 * `<script setup>` block with `migrateSource`, the same as a `.ts` or `.js`
 * file, and keeps the rest of the file as it is. It skips a block with `src`
 * (its code is in that file, which the other steps migrate) and a block in a
 * language other than JavaScript or TypeScript.
 *
 * Returns the new file, or `null` when no block changed.
 */
const codemod: Codemod<HTML> = async (root) => {
  const filename = root.filename();
  // Vue reads only top-level blocks. A `<script>` in the template or in a
  // custom block such as `<docs>` is not one. When a template expression has
  // the text `<script>`, the grammar reads from there to the next `</script>`
  // as one script under an ERROR node. That is not a block, and the grammar
  // finds no blocks after it, so the file stays as it is.
  const blocks = root
    .root()
    .children()
    .filter((node) => node.kind() === "script_element");
  const edits: Edit[] = [];
  for (const block of blocks) {
    const startTag = block.find({ rule: { kind: "start_tag" } });
    const code = block.find({ rule: { kind: "raw_text" } });
    if (!startTag || !code) continue;
    const attributes = attributesOf(startTag);
    const grammar = grammarOf(attributes.get("lang") ?? "");
    if (!grammar || attributes.has("src")) continue;
    const migrated = migrateSource(code.text(), { ...grammar, filename });
    // `replace` and `commitEdits` both count in bytes, so text with
    // non-ASCII characters before the block keeps its place.
    if (migrated !== null) edits.push(code.replace(migrated));
  }
  return edits.length === 0 ? null : root.root().commitEdits(edits);
};

export default codemod;
