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
    // don't insert empty text - results in strange visual behavior
    Transforms.insertNodes(
      editor,
      [
        {
          type: "paragraph",
          children: [{ text: newText }],
        },
      ],
      {
        at: [0],
      },
    );
  }
}
