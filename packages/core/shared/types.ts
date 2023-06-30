import { ParameterProperty } from './openai_function_calling/types'

/**
 * Shared types between the API and UI packages.
 */
export type CopilotMutation<Inputs extends any[]> = {
  function: (...args: Inputs) => any
}
