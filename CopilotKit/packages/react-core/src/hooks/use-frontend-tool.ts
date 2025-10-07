import { useCopilotAction } from "./use-copilot-action";
import { FrontendAction } from "../types/frontend-action";
import { Parameter } from "@copilotkit/shared";

type UseToolCallArgs<T extends Parameter[] | [] = []> = {
  available?: "disabled" | "enabled";
} & Pick<
  FrontendAction<T>,
  "name" | "description" | "parameters" | "handler" | "followUp" | "render"
>;

export function useFrontendTool<const T extends Parameter[] | [] = []>(
  tool: UseToolCallArgs<T>,
  dependencies?: any[],
) {
  // Use the existing useCopilotAction hook
  useCopilotAction<T>(tool, dependencies);
}
