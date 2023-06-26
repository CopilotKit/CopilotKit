import { useState, useCallback } from 'react'

export type TreeNodeId = string

interface TreeNode {
  id: TreeNodeId
  value: string
  children: TreeNode[]
  parentId?: TreeNodeId
}

export type Tree = TreeNode[]

export interface UseTreeReturn {
  tree: Tree
  addElement: (id: TreeNodeId, value: string, parentId?: TreeNodeId) => void
  removeElement: (id: TreeNodeId) => void
  printTree: () => string
}

const findNode = (nodes: Tree, id: TreeNodeId): TreeNode | undefined => {
  for (const node of nodes) {
    if (node.id === id) {
      return node
    }
    const result = findNode(node.children, id)
    if (result) {
      return result
    }
  }
  return undefined
}

const removeNode = (nodes: Tree, id: TreeNodeId): Tree => {
  return nodes.reduce((result: Tree, node) => {
    if (node.id !== id) {
      const newNode = { ...node, children: removeNode(node.children, id) }
      result.push(newNode)
    }
    return result
  }, [])
}

const treeIndentationRepresentation = (
  index: number,
  indentLevel: number
): string => {
  if (indentLevel === 0) {
    return (index + 1).toString()
  } else if (indentLevel === 1) {
    return String.fromCharCode(65 + index) // 65 is the ASCII value for 'A'
  } else if (indentLevel === 2) {
    return String.fromCharCode(97 + index) // 97 is the ASCII value for 'a'
  } else {
    throw new Error('Indentation level not supported')
  }
}

const printNode = (node: TreeNode, prefix = '', indentLevel = 0): string => {
  let output = prefix + node.value + '\n'
  node.children.forEach(
    (child, index) =>
      (output += printNode(
        child,
        `${prefix}${treeIndentationRepresentation(index, indentLevel + 1)}. `,
        indentLevel + 1
      ))
  )
  return output
}

const useTree = (): UseTreeReturn => {
  const [tree, setTree] = useState<Tree>([])

  const addElement = useCallback(
    (id: TreeNodeId, value: string, parentId?: TreeNodeId): void => {
      const newNode: TreeNode = {
        id,
        value,
        children: []
      }

      if (parentId) {
        const parent = findNode(tree, parentId)
        if (parent) {
          newNode.parentId = parentId
          parent.children.push(newNode)
        } else {
          throw new Error(`Parent with id ${parentId} not found`)
        }
      } else {
        setTree(prevTree => [...prevTree, newNode])
      }
    },
    [tree]
  )

  const removeElement = useCallback((id: TreeNodeId): void => {
    setTree(prevTree => removeNode(prevTree, id))
  }, [])

  const printTree = (): string => {
    let output = ''
    tree.forEach(
      (node, index) =>
        (output += printNode(
          node,
          `${treeIndentationRepresentation(index, 0)}. `
        ))
    )
    return output
  }

  return { tree, addElement, printTree, removeElement }
}

export default useTree
