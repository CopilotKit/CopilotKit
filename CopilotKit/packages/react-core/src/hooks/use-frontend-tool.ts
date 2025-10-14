import { useCopilotAction } from "./use-copilot-action";
import { FrontendAction } from "../types/frontend-action";
import { Parameter, ParametersToRecord } from "@copilotkit/shared";
import {
  ReactFrontendTool,
  useFrontendTool as useFrontendToolVNext,
} from "@copilotkitnext/react";
import { getZodParameters } from "../utils/utils";
import { z } from "zod";

type UseToolCallArgs<T extends Parameter[] | [] = []> = {
  available?: "disabled" | "enabled";
} & Pick<
  FrontendAction<T>,
  "name" | "description" | "parameters" | "handler" | "followUp" | "render"
>;

// Helper type to extract the inferred type from a Zod schema
type InferZodRecord<ZodType extends z.ZodTypeAny> = z.infer<ZodType>;

export function useFrontendTool<const T extends Parameter[] = []>(
  tool: UseToolCallArgs<T>,
  dependencies?: any[],
) {
  const { name, description, parameters, render, followUp } = tool
  const zodParameters = getZodParameters(parameters)

  useFrontendToolVNext({
    name,
    description,
    parameters: zodParameters,
    handler: tool.handler,
    followUp,
    render: render as unknown as ReactFrontendTool<ParametersToRecord<T>>["render"],
  })
  // Use the existing useCopilotAction hook
  useCopilotAction<T>(tool, dependencies);
}
