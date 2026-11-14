import { Editor, Transforms } from "slate";

export function replaceEditorText(editor: Editor, newText: string) {
  // clear all previous text
  Transforms.delete(editor, {
    at: {
      anchor: Editor.start(editor, []),
      focus: Editor.end(editor, []),
    },
  });

  // insert new text
  if (newText && newText !== "") {
    // Don't insert empty text - results in strange visual behavior.
    // Insert into the empty block the delete above left behind rather than
    // adding a new one: `insertNodes` at [0] would prepend a second block and
    // leave a trailing empty paragraph, so the text would read back with a
    // trailing newline and grow on every call.
    Transforms.insertText(editor, newText, {
      at: Editor.start(editor, []),
    });
  }
}
