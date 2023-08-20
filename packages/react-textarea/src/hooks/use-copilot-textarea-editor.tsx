import { createEditor, Node } from "slate";
import { withReact } from "slate-react";
import { useMemo } from "react";
import { CustomEditor } from "../types/custom-editor";
import {
  withPartialHistory,
  ShouldSaveToHistory,
  defaultShouldSave,
} from "../lib/slatejs-edits/with-partial-history";

const shouldSave: ShouldSaveToHistory = (editor, operation) => {
  // haven't figured this out yet
  const fallback = defaultShouldSave(editor, operation);
  return fallback;
};

export function useCopilotTextareaEditor(): CustomEditor {
  const editor = useMemo(() => {
    const editor = withPartialHistory(withReact(createEditor()), shouldSave);

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
  }, []);

  return editor;
}
