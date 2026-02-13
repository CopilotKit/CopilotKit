import { BasePoint, Transforms } from "slate";
import { CustomEditor } from "../../types/base/custom-editor";

export function addAutocompletionsToEditor(
  editor: CustomEditor,
  newSuggestion: string,
  point: BasePoint,
) {
  const editorPosition = editor.selection;

  Transforms.insertNodes(
    editor,
    [
      {
        type: "suggestion",
        inline: true,
        content: newSuggestion,
        children: [{ text: "" }],
      },
    ],
    {
      at: point,
    },
  );

  // restore cursor position
  if (editorPosition) {
    editor.selection = editorPosition;
  }
}
