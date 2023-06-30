'use client'

import { useRef, useContext, useEffect, useMemo } from 'react'
import { CopilotContext } from './copilot-context'
import { generateRandomString } from './utils'

export function useMakeCopilotActionable<ActionInput extends any[]>(
  annotatedFunction: AnnotatedFunction<ActionInput>,
  dependencies: any[]
) {
  const idRef = useRef(generateRandomString(10)) // generate a unique id
  const { setEntryPoint, removeEntryPoint } = useContext(CopilotContext)

  const memoizedAnnotatedFunction = useMemo(
    () => ({
      description: annotatedFunction.description,
      argumentAnnotations: annotatedFunction.argumentAnnotations,
      implementation: annotatedFunction.implementation
    }),
    dependencies
  )

  useEffect(() => {
    setEntryPoint(
      idRef.current,
      memoizedAnnotatedFunction as AnnotatedFunction<any[]>
    )

    return () => {
      removeEntryPoint(idRef.current)
    }
  }, [memoizedAnnotatedFunction, setEntryPoint, removeEntryPoint])
}

export interface AnnotatedFunctionArgument {
  name: string
  type: string
  description: string
  allowedValues?: any[]
  required: boolean
}

export interface AnnotatedFunction<Inputs extends any[]> {
  name: string
  description: string
  argumentAnnotations: AnnotatedFunctionArgument[]
  implementation: (...args: Inputs) => Promise<void>
}
