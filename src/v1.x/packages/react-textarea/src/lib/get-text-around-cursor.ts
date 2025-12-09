import { Editor, Node, Path, Range, Text, Element, BasePoint, BaseRange, Point } from "slate";
import { EditorAutocompleteState } from "../types/base/editor-autocomplete-state";

export interface EditorTextState {
  selection: BaseRange;

  textBeforeCursor: string;
  selectedText: string;
  textAfterCursor: string;
}

export function getTextAroundCollapsedCursor(editor: Editor): EditorAutocompleteState | null {
  const { selection } = editor;
  if (!selection || !Range.isCollapsed(selection)) {
    return null;
  }

  const cursorPoint = selection.anchor;

  // Create two ranges: one before the anchor and one after
  const beforeRange: Range = {
    anchor: Editor.start(editor, []),
    focus: cursorPoint,
  };
  const afterRange: Range = {
    anchor: cursorPoint,
    focus: Editor.end(editor, []),
  };

  // Extract text for these ranges
  const before = extractTextWithNewlines(editor, beforeRange);
  const after = extractTextWithNewlines(editor, afterRange);

  return {
    cursorPoint: cursorPoint,
    textBeforeCursor: before,
    textAfterCursor: after,
  };
}

export function getTextAroundSelection(editor: Editor): EditorTextState | null {
  const { selection } = editor;
  if (!selection) {
    return null;
  }

  const wellOrderedSelection = wellOrderedRange(selection);

  // Create two ranges: one before the anchor and one after
  const beforeRange: Range = {
    anchor: Editor.start(editor, []),
    focus: wellOrderedSelection.anchor,
  };
  const afterRange: Range = {
    anchor: wellOrderedSelection.focus,
    focus: Editor.end(editor, []),
  };

  // Extract text for these ranges
  const before = extractTextWithNewlines(editor, beforeRange);
  const after = extractTextWithNewlines(editor, afterRange);
  const selectedText = extractTextWithNewlines(editor, wellOrderedSelection);

  return {
    selection: wellOrderedSelection,
    textBeforeCursor: before,
    selectedText,
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

function wellOrderedRange(range: BaseRange): BaseRange {
  const { anchor, focus } = range;
  // if anchor is before focus, return range as is
  if (Point.isBefore(anchor, focus)) {
    return range;
  }

  // if focus is before anchor, return range with anchor and focus swapped
  return {
    anchor: focus,
    focus: anchor,
  };
}
