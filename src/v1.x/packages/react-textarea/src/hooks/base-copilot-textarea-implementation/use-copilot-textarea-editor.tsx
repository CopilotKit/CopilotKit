import { useMemo } from "react";
import { createEditor, Element } from "slate";
import { withReact } from "slate-react";
import {
  defaultShouldSave,
  ShouldSaveToHistory,
  withPartialHistory,
} from "../../lib/slatejs-edits/with-partial-history";
import { CustomEditor } from "../../types/base/custom-editor";

const shouldSave: ShouldSaveToHistory = (op, prev) => {
  const excludedNodeType = "suggestion";
  // Check if the operation involves the suggestion inline node type
  if (
    op.type === "insert_node" &&
    Element.isElement(op.node) &&
    op.node.type === excludedNodeType
  ) {
    return false;
  }

  if (
    op.type === "remove_node" &&
    Element.isElement(op.node) &&
    op.node.type === excludedNodeType
  ) {
    return false;
  }

  if (
    op.type === "set_node" &&
    "type" in op.newProperties &&
    op.newProperties.type === excludedNodeType
  ) {
    return false;
  }

  if (op.type == "set_node" && "type" in op.properties && op.properties.type === excludedNodeType) {
    return false;
  }

  if (
    op.type === "merge_node" &&
    "type" in op.properties &&
    op.properties.type === excludedNodeType
  ) {
    return false;
  }

  if (
    op.type === "split_node" &&
    "type" in op.properties &&
    op.properties.type === excludedNodeType
  ) {
    return false;
  }

  // Otherwise, save the operation to history
  return defaultShouldSave(op, prev);
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
