import { Editor, Node, Path, Range, Text, Element } from "slate";
import { EditorAutocompleteState } from "../types/editor-autocomplete-state";

export function getTextAroundCursor(
  editor: Editor
): EditorAutocompleteState | null {
  const { selection } = editor;

  if (!selection || !Range.isCollapsed(selection)) {
    return null;
  }
  // Create two ranges: one before the anchor and one after
  const beforeRange: Range = {
    anchor: Editor.start(editor, []),
    focus: selection.anchor,
  };
  const afterRange: Range = {
    anchor: selection.anchor,
    focus: Editor.end(editor, []),
  };

  // Extract text for these ranges
  const before = extractTextWithNewlines(editor, beforeRange);
  const after = extractTextWithNewlines(editor, afterRange);

  return {
    cursorPoint: selection.anchor,
    textBeforeCursor: before,
    textAfterCursor: after,
  };
}

export function getFullEditorTextWithNewlines(editor: Editor): string {
  const fullDocumentRange: Range = {
    anchor: Editor.start(editor, []),
    focus: Editor.end(editor, []),
  };
  return extractTextWithNewlines(editor, fullDocumentRange);
}

// Helper function to extract text with newlines
export function extractTextWithNewlines(editor: Editor, range: Range): string {
  const voids = false;
  const [start, end] = Range.edges(range);
  let text = "";
  let lastBlock: Node | null = null;

  for (const [node, path] of Editor.nodes(editor, {
    at: range,
    match: Text.isText,
    voids,
  })) {
    let t = node.text;

    // Determine the parent block of the current text node
    const [block] = Editor.above(editor, {
      at: path,
      match: (n) => Element.isElement(n) && n.type === "paragraph",
    }) || [null];

    // If we encounter a new block, prepend a newline
    if (lastBlock !== block && block) {
      // check that lastBlock is not null to avoid adding a newline at the beginning
      if (lastBlock) {
        text += "\n";
      }
      lastBlock = block;
    }

    if (Path.equals(path, end.path)) {
      t = t.slice(0, end.offset);
    }

    if (Path.equals(path, start.path)) {
      t = t.slice(start.offset);
    }

    text += t;
  }

  return text;
}
