'use client'

import React, { useState, ReactNode, useCallback } from 'react'
import { AnnotatedFunction } from './use-make-copilot-actionable'
import useTree, { TreeNodeId } from './useTree'

export interface CopilotContextParams {
  entryPoints: Record<string, AnnotatedFunction<any[]>>
  setEntryPoint: (id: string, entryPoint: AnnotatedFunction<any[]>) => void
  removeEntryPoint: (id: string) => void

  getContextString: () => string
  addContext: (context: string, parentId?: string) => TreeNodeId
  removeContext: (id: TreeNodeId) => void
}
export const CopilotContext = React.createContext<CopilotContextParams>(
  {} as CopilotContextParams
)

export function CopilotProvider({
  children
}: {
  children: ReactNode
}): JSX.Element {
  const [entryPoints, setEntryPoints] = useState<
    Record<string, AnnotatedFunction<any[]>>
  >({})

  const { addElement, removeElement, printTree } = useTree()

  const setEntryPoint = useCallback(
    (id: string, entryPoint: AnnotatedFunction<any[]>) => {
      setEntryPoints(prevPoints => {
        return {
          ...prevPoints,
          [id]: entryPoint
        }
      })
    },
    []
  )

  const removeEntryPoint = useCallback((id: string) => {
    setEntryPoints(prevPoints => {
      const newPoints = { ...prevPoints }
      delete newPoints[id]
      return newPoints
    })
  }, [])

  const getContextString = useCallback(() => {
    return printTree()
  }, [printTree])

  const addContext = useCallback(
    (context: string, parentId?: string) => {
      return addElement(context, parentId)
    },
    [addElement]
  )

  const removeContext = useCallback(
    (id: string) => {
      removeElement(id)
    },
    [removeElement]
  )

  return (
    <CopilotContext.Provider
      value={{
        entryPoints,
        setEntryPoint,
        removeEntryPoint,
        getContextString,
        addContext,
        removeContext
      }}
    >
      {children}
    </CopilotContext.Provider>
  )
}
