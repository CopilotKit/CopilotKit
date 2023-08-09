import { BaseEditor, Element } from "slate";
import { HistoryEditor } from "slate-history";
import { ReactEditor } from "slate-react";
import { SuggestionAwareText } from "../components/copilot-textarea/copilot-textarea";

export const editorToText = (
  editor: BaseEditor & ReactEditor & HistoryEditor
) => {
  const suggestionAwareTextComponents: SuggestionAwareText[][] =
    editor.children.map((node) => {
      if (Element.isElement(node)) {
        return node.children.map((child) => {
          return child;
        });
      } else {
        return [node];
      }
    });

  const flattened = suggestionAwareTextComponents.reduce(
    (acc, val) => acc.concat(val),
    []
  );
  const text = flattened.map((textComponent) => textComponent.text).join("\n");
  return text;
};
