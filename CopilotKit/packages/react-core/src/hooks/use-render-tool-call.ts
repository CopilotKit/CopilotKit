import { useCopilotAction } from "./use-copilot-action";
import { FrontendAction, FrontendActionAvailability } from "../types";
import { Parameter } from "@copilotkit/shared";

type UseToolCallArgs<T extends Parameter[] | [] = []> = {
  available?: "disabled" | undefined;
} & Pick<FrontendAction<T>, "name" | "description" | "parameters" | "render">;

export function useRenderToolCall<const T extends Parameter[] | [] = []>(
  tool: UseToolCallArgs<T>,
  dependencies?: any[],
) {
  useCopilotAction<T>(
    {
      ...tool,
      available: tool.available ? tool.available : "frontend",
    },
    dependencies,
  );
}
