import { useCopilotAction } from "./use-copilot-action";
import { FrontendAction } from "../types";
import { Parameter } from "@copilotkit/shared";

export function useRenderToolCall<const T extends Parameter[] | [] = []>(
  tool: Pick<FrontendAction<T>, "name" | "description" | "parameters" | "render">,
  dependencies?: any[],
) {
  useCopilotAction<T>(
    {
      ...tool,
      available: "frontend",
    },
    dependencies,
  );
}
