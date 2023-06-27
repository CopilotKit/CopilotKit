'use client'

import { useRef, useContext, useEffect } from 'react'
import { CopilotContext } from './CopilotContext'
import { generateRandomString } from './utils'

export function useMakeCopilotReadable(
  information: string,
  parentId?: string
): string | undefined {
  const { addContext, removeContext } = useContext(CopilotContext)
  const idRef = useRef<string>()

  useEffect(() => {
    const id = addContext(information, parentId)
    idRef.current = id

    return () => {
      removeContext(id)
    }
  }, [information, parentId, addContext, removeContext])

  return idRef.current
}
