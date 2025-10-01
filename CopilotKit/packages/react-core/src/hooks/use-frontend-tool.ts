import { useCopilotAction } from "./use-copilot-action";
import { FrontendAction } from "../types/frontend-action";
import { Parameter } from "@copilotkit/shared";

export function useFrontendTool<T extends Parameter[] | [] = []>(
  tool: Pick<
    FrontendAction<T>,
    "name" | "description" | "parameters" | "handler" | "followUp" | "render"
  >,
  dependencies?: any[],
) {
  // Use the existing useCopilotAction hook
  useCopilotAction(
    {
      ...tool,
    },
    dependencies,
  );
}
