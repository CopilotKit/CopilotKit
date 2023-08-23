import { Editor, Path, Transforms, Node, Element } from "slate";

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
    Transforms.removeNodes(editor, { at: path });
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
