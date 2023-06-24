'use client'

import { useRef, useContext, useEffect } from 'react'
import { CopilotContext } from './CopilotContext'
import { generateRandomString } from './utils'

export function useMakeCopilotWritable<ActionInput extends any[]>(
  annotatedFunction: AnnotatedFunction<ActionInput>
) {
  const idRef = useRef(generateRandomString(10)) // generate a unique id
  const { setEntryPoint, removeEntryPoint } = useContext(CopilotContext)

  useEffect(() => {
    setEntryPoint(idRef.current, annotatedFunction as AnnotatedFunction<any[]>)

    return () => {
      removeEntryPoint(idRef.current)
    }
  }, [annotatedFunction, setEntryPoint, removeEntryPoint])
}

export interface AnnotatedFunctionArgument {
  name: string
  type: string
  description: string
  allowedValues?: any[]
  required: boolean
}

export interface AnnotatedFunction<Inputs extends any[]> {
  description: string
  argumentAnnotations: AnnotatedFunctionArgument[]
  implementation: (...args: Inputs) => void
}
