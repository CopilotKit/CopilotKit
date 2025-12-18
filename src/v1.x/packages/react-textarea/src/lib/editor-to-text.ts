import { BaseEditor, Descendant, Element } from "slate";
import { HistoryEditor } from "slate-history";
import { ReactEditor } from "slate-react";
import { SuggestionAwareText } from "../types/base/custom-editor";

function nodeChildrenToTextComponents(
  editor: BaseEditor & ReactEditor & HistoryEditor,
  nodes: Descendant[],
): SuggestionAwareText[] {
  // find inlineable elements
  const indeciesOfInlineElements = new Set(
    nodes
      .map((node, index) => {
        if (Element.isElement(node) && editor.isInline(node)) {
          return index;
        }
        return -1;
      })
      .filter((index) => index !== -1),
  );

  // ignorable elements = inline elements,
  // or neighbors of inline elements that are {text: ""}
  const nonIgnorableItems = nodes.filter((node, index) => {
    const isInline = indeciesOfInlineElements.has(index);
    if (isInline) {
      return false;
    }

    const isNeighbourOfInline =
      indeciesOfInlineElements.has(index - 1) || indeciesOfInlineElements.has(index + 1);
    if (isNeighbourOfInline) {
      return (node as any).text !== "";
    }

    return true;
  });

  return nonIgnorableItems
    .map((node) => {
      if (Element.isElement(node)) {
        switch (node.type) {
          case "paragraph":
            return nodeChildrenToTextComponents(editor, node.children);
          case "suggestion":
            return [];
        }
      } else {
        return [node];
      }
    })
    .reduce((acc, val) => acc.concat(val), []);
}

export const editorToText = (editor: BaseEditor & ReactEditor & HistoryEditor) => {
  const flattened = nodeChildrenToTextComponents(editor, editor.children);

  const text = flattened.map((textComponent) => textComponent.text).join("\n");

  return text;
};
