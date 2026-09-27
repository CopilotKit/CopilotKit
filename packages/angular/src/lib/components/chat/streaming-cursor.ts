/*
 * The streaming cursor rides at the end of a reply's text while it's written.
 * `markCursorAnchor` marks where it can go: the reply's last block that holds
 * text (a paragraph, list item, heading or table cell). CSS shows the cursor
 * on that mark only while the message streams, so turning the cursor on or off
 * never re-renders the markdown. Mirrors React's `rehypeCursorAnchor`.
 */

// Blocks the cursor descends through to reach the end of the text…
const CONTAINERS = new Set([
  "UL",
  "OL",
  "BLOCKQUOTE",
  "TABLE",
  "THEAD",
  "TBODY",
  "TR",
]);
// …and the blocks whose text it follows.
const TEXT_BLOCKS = new Set([
  "P",
  "LI",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "TD",
  "TH",
]);

/** The renderer's frame around each table (`.cpk-md-table`). */
function isTableFrame(element: Element): boolean {
  return element.classList.contains("cpk-md-table");
}

function lastContentChild(node: Element): ChildNode | null {
  for (let child = node.lastChild; child; child = child.previousSibling) {
    if (child.nodeType === Node.ELEMENT_NODE) return child;
    if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
      return child;
    }
  }
  return null;
}

/** Marks the cursor position inside rendered markdown with `data-cursor-anchor`. */
export function markCursorAnchor(root: Element): void {
  let node = root;
  let anchor: Element | undefined;
  for (;;) {
    const last = lastContentChild(node);
    if (last?.nodeType !== Node.ELEMENT_NODE) break;
    const element = last as Element;
    if (TEXT_BLOCKS.has(element.tagName)) anchor = element;
    else if (!CONTAINERS.has(element.tagName) && !isTableFrame(element)) break;
    node = element;
  }
  anchor?.setAttribute("data-cursor-anchor", "");
}
