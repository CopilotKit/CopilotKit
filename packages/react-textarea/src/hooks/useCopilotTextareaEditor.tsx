import { createEditor } from "slate";
import { withReact } from "slate-react";
import { useState } from "react";
import { CustomEditor } from "../types/custom-editor";

export function useCopilotTextareaEditor(): CustomEditor {
  const [editor] = useState(() => {
    const editor = withReact(createEditor());

    const { isVoid } = editor;
    editor.isVoid = (element) => {
      switch (element.type) {
        case "suggestion":
          return true;
        default:
          return isVoid(element);
      }
    };

    const { markableVoid } = editor;
    editor.markableVoid = (element) => {
      switch (element.type) {
        case "suggestion":
          return true;
        default:
          return markableVoid(element);
      }
    };

    const { isInline } = editor;
    editor.isInline = (element) => {
      switch (element.type) {
        case "suggestion":
          return element.inline;
        default:
          return isInline(element);
      }
    };

    return editor;
  });

  return editor;
}
