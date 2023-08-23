import { Path, Node, Element, Transforms } from "slate";
import { CustomEditor } from "../../types/base/custom-editor";

export function clearAutocompletionsFromEditor(editor: CustomEditor) {
  // clear previous suggestion
  const paths: Path[] = [];
  for (const [node, path] of Node.nodes(editor)) {
    if (Element.isElement(node) && node.type === "suggestion") {
      paths.push(path);
    }
  }
  for (const path of paths) {
    Transforms.removeNodes(editor, { at: path });
  }
}
