import { nanoid } from "nanoid";
import { useReducer, useCallback } from "react";

export type TreeNodeId = string;

export interface TreeNode {
  id: TreeNodeId;
  value: string;
  children: TreeNode[];
  parentId?: TreeNodeId;
}

export type Tree = TreeNode[];

export interface UseTreeReturn {
  tree: Tree;
  addElement: (value: string, parentId?: TreeNodeId) => TreeNodeId;
  printTree: () => string;
  removeElement: (id: TreeNodeId) => void;
}

const findNode = (nodes: Tree, id: TreeNodeId): TreeNode | undefined => {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const result = findNode(node.children, id);
    if (result) {
      return result;
    }
  }
  return undefined;
};

const removeNode = (nodes: Tree, id: TreeNodeId): Tree => {
  return nodes.reduce((result: Tree, node) => {
    if (node.id !== id) {
      const newNode = { ...node, children: removeNode(node.children, id) };
      result.push(newNode);
    }
    return result;
  }, []);
};

const treeIndentationRepresentation = (
  index: number,
  indentLevel: number
): string => {
  if (indentLevel === 0) {
    return (index + 1).toString();
  } else if (indentLevel === 1) {
    return String.fromCharCode(65 + index); // 65 is the ASCII value for 'A'
  } else if (indentLevel === 2) {
    return String.fromCharCode(97 + index); // 97 is the ASCII value for 'a'
  } else {
    throw new Error("Indentation level not supported");
  }
};

const printNode = (node: TreeNode, prefix = "", indentLevel = 0): string => {
  const indent = " ".repeat(3).repeat(indentLevel);

  const prefixPlusIndentLength = prefix.length + indent.length;
  const subsequentLinesPrefix = " ".repeat(prefixPlusIndentLength);

  const valueLines = node.value.split("\n");

  const outputFirstLine = `${indent}${prefix}${valueLines[0]}`;
  const outputSubsequentLines = valueLines
    .slice(1)
    .map((line) => `${subsequentLinesPrefix}${line}`)
    .join("\n");

  let output = `${outputFirstLine}\n`;
  if (outputSubsequentLines) {
    output += `${outputSubsequentLines}\n`;
  }

  node.children.forEach(
    (child, index) =>
      (output += printNode(
        child,
        `${prefix}${treeIndentationRepresentation(index, indentLevel + 1)}. `,
        indentLevel + 1
      ))
  );
  return output;
};

// Action types
type Action =
  | { type: "ADD_NODE"; value: string; parentId?: string; id: string }
  | { type: "REMOVE_NODE"; id: string };

// Reducer function
function treeReducer(state: Tree, action: Action): Tree {
  switch (action.type) {
    case "ADD_NODE": {
      const { value, parentId, id: newNodeId } = action;
      const newNode: TreeNode = {
        id: newNodeId,
        value,
        children: [],
      };

      if (parentId) {
        const parent = findNode(state, parentId);
        if (parent) {
          newNode.parentId = parentId;
          parent.children.push(newNode);
        } else {
          throw new Error(`Parent with id ${parentId} not found`);
        }
      } else {
        return [...state, newNode];
      }

      return state;
    }
    case "REMOVE_NODE":
      return removeNode(state, action.id);
    default:
      return state;
  }
}

// useTree hook
const useTree = (): UseTreeReturn => {
  const [tree, dispatch] = useReducer(treeReducer, []);

  const addElement = useCallback(
    (value: string, parentId?: string): TreeNodeId => {
      const newNodeId = nanoid(); // Generate new ID outside of dispatch
      dispatch({ type: "ADD_NODE", value, parentId, id: newNodeId });
      return newNodeId; // Return the new ID
    },
    []
  );

  const removeElement = useCallback((id: TreeNodeId): void => {
    dispatch({ type: "REMOVE_NODE", id });
  }, []);

  const printTree = (): string => {
    let output = "";
    tree.forEach(
      (node, index) =>
        (output += printNode(
          node,
          `${treeIndentationRepresentation(index, 0)}. `
        ))
    );
    return output;
  };

  return { tree, addElement, printTree, removeElement };
};

export default useTree;
