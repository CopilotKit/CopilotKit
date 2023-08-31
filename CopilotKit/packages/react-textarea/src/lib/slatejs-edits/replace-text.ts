import { Editor, Element, Node, Path, Transforms } from "slate";

export function replaceEditorText(editor: Editor, newText: string) {
  // clear all previous text
  const paths: Path[] = [];
  for (const [node, path] of Node.nodes(editor)) {
    if (
      Element.isElement(node) &&
      (node.type === "paragraph" || node.type === "suggestion") &&
      path.length === 1
    ) {
      paths.push(path);
    }
  }
  for (const path of paths) {
    try {
      Transforms.removeNodes(editor, { at: path });
    } catch (e) {
      console.log("CopilotTextarea.replaceEditorText: error removing node", e);
    }
  }

  // insert new text
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
    }
  );
}
