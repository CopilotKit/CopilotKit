import { useCopilotAction } from "./use-copilot-action";
import { FrontendAction } from "../types";
import { Parameter } from "@copilotkit/shared";

type UseToolCallArgs<T extends Parameter[] | [] = []> = {
  available?: "disabled" | "enabled";
  render: FrontendAction<T>["renderAndWaitForResponse"];
} & Pick<FrontendAction<T>, "name" | "description" | "parameters">;

export function useHumanInTheLoop<const T extends Parameter[] | [] = []>(
  tool: UseToolCallArgs<T>,
  dependencies?: any[],
) {
  const { render, ...toolRest } = tool;

  useCopilotAction(
    {
      ...toolRest,
      available: tool.available === "disabled" ? tool.available : "remote",
      renderAndWaitForResponse: render,
    },
    dependencies,
  );
}
