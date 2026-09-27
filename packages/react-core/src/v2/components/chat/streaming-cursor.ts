/*
 * The streaming cursor rides at the end of a reply's text while it's written.
 * This rehype plugin marks where it can go: the last block in each rendered
 * chunk that holds text (a paragraph, list item, heading or table cell). CSS
 * shows the cursor on the reply's final mark only, and only while it streams,
 * so turning the cursor on or off never re-renders the markdown.
 */

/** The slice of a hast node this plugin reads. */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

// Blocks the cursor descends through to reach the end of the text…
const CONTAINERS = new Set([
  "ul",
  "ol",
  "blockquote",
  "table",
  "thead",
  "tbody",
  "tr",
]);
// …and the blocks whose text it follows.
const TEXT_BLOCKS = new Set([
  "p",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "td",
  "th",
]);

function lastContentChild(node: HastNode): HastNode | undefined {
  return node.children?.findLast(
    (child) => child.type === "element" || child.value?.trim(),
  );
}

/** Marks the cursor position with `data-cursor-anchor`. */
export function rehypeCursorAnchor(): (tree: HastNode) => void {
  return (tree: HastNode) => {
    let node = tree;
    let anchor: HastNode | undefined;
    for (;;) {
      const last = lastContentChild(node);
      const tag = last?.type === "element" ? last.tagName : undefined;
      if (!last || !tag) break;
      if (TEXT_BLOCKS.has(tag)) anchor = last;
      else if (!CONTAINERS.has(tag)) break;
      node = last;
    }
    if (anchor) {
      anchor.properties = { ...anchor.properties, dataCursorAnchor: "" };
    }
  };
}
