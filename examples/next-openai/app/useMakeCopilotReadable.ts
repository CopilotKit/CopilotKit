'use client'

import { useRef, useContext, useEffect } from 'react'
import { CopilotContext } from './CopilotContext'
import { generateRandomString } from './utils'

export function useMakeCopilotReadable(
  information: string,
  parentId?: string
): string {
  const idRef = useRef(generateRandomString(10)) // generate a unique id
  const { addContext, removeContext } = useContext(CopilotContext)

  useEffect(() => {
    addContext(idRef.current, information, parentId)

    return () => {
      removeContext(idRef.current)
    }
  }, [information, parentId, addContext, removeContext])

  return idRef.current
}
