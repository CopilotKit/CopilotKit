const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ATX_HEADING = /^(\s{0,3})(#{1,6})(\s|$)/;

/** A fence closes the block it opened: same character, at least as long. */
function closesFence(line: string, opener: string): boolean {
  const fence = FENCE.exec(line)?.[1];
  return (
    fence !== undefined &&
    fence[0] === opener[0] &&
    fence.length >= opener.length &&
    line.trim() === fence
  );
}

/**
 * Prepares text a user typed for markdown rendering the way chat apps show it:
 * code blocks, lists, emphasis, links and tables render, while line breaks stay
 * where the user put them and `#` lines stay literal instead of becoming
 * headings. Pair with `remarkHtmlAsText` so pasted HTML shows as text.
 */
export function prepareUserMarkdown(text: string): string {
  const lines = text.split("\n");
  let fence: string | undefined;

  return lines
    .map((line, index) => {
      if (fence) {
        if (closesFence(line, fence)) fence = undefined;
        return line;
      }
      const opener = FENCE.exec(line)?.[1];
      if (opener) {
        fence = opener;
        return line;
      }

      const escaped = line.replace(ATX_HEADING, "$1\\$2$3");
      const next = lines[index + 1];
      // Markdown folds single newlines into spaces; a trailing double space
      // keeps them as typed. Blank lines already separate paragraphs.
      const keepBreak =
        next !== undefined &&
        escaped.trim() !== "" &&
        next.trim() !== "" &&
        !FENCE.test(next);
      return keepBreak ? `${escaped}  ` : escaped;
    })
    .join("\n");
}

/** The slice of an mdast node `remarkHtmlAsText` reads. */
interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
}

// Parents whose children are blocks, where HTML text needs a paragraph.
const BLOCK_PARENTS = new Set(["root", "blockquote", "listItem"]);

/** HTML as the literal text the user typed, keeping its line breaks. */
function htmlText(value: string): MdastNode[] {
  return value
    .split("\n")
    .flatMap((line, i) => [
      ...(i > 0 ? [{ type: "break" }] : []),
      { type: "text", value: line.trimEnd() },
    ]);
}

/**
 * Remark plugin: shows HTML in a user's message (pasted HTML or JSX) as text
 * instead of rendering it. The parser has already told code spans and code
 * blocks apart, so their contents are left as typed.
 */
export function remarkHtmlAsText(): (tree: MdastNode) => void {
  const visit = (node: MdastNode) => {
    node.children = node.children?.flatMap((child) => {
      if (child.type !== "html") {
        visit(child);
        return [child];
      }
      const text = htmlText(child.value ?? "");
      return BLOCK_PARENTS.has(node.type)
        ? [{ type: "paragraph", children: text }]
        : text;
    });
  };
  return visit;
}
