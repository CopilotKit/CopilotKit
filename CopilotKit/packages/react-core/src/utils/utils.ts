import { z } from "zod/index";
import {
  actionParametersToJsonSchema,
  convertJsonSchemaToZodSchema,
  Parameter,
} from "@copilotkit/shared";

export {};


export function getZodParameters<T extends [] | Parameter[] | undefined>(
  parameters: T
): any {
  if (!parameters) return z.object({})
  const jsonParams = actionParametersToJsonSchema(parameters)
  return convertJsonSchemaToZodSchema(jsonParams, true)
}
