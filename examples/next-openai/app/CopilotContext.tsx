'use client'

import React, { useState, ReactNode } from 'react'
import { AnnotatedFunction } from './useMakeCopilotWritable'
import useTree, { TreeNodeId } from './useTree'

export interface CopilotContextParams {
  entryPoints: Record<string, AnnotatedFunction<any[]>>
  setEntryPoint: (id: string, entryPoint: AnnotatedFunction<any[]>) => void
  removeEntryPoint: (id: string) => void

  getContextString: () => string
  addContext: (id: string, context: string, parentId?: string) => void
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

  const setEntryPoint = (
    id: string,
    annotatedFunction: AnnotatedFunction<any[]>
  ) => {
    setEntryPoints(prevPoints => ({
      ...prevPoints,
      [id]: annotatedFunction
    }))
  }

  const removeEntryPoint = (id: string) => {
    setEntryPoints(prevPoints => {
      const newPoints = { ...prevPoints }
      delete newPoints[id]
      return newPoints
    })
  }

  const getContextString = () => {
    return printTree()
  }

  const addContext = (id: string, context: string, parentId?: string) => {
    return addElement(id, context, parentId)
  }

  const removeContext = (id: string) => {
    removeElement(id)
  }

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
