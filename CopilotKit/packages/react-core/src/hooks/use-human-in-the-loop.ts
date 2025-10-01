import { useCopilotAction } from "./use-copilot-action";
import { FrontendAction } from "../types";
import { Parameter } from "@copilotkit/shared";

export function useHumanInTheLoop<T extends Parameter[] | [] = []>(
  tool: Pick<FrontendAction<T>, "name" | "description" | "parameters"> & {
    render: FrontendAction<T>["renderAndWaitForResponse"];
  },
  dependencies?: any[],
) {
  const { render, ...toolRest } = tool;

  useCopilotAction(
    {
      ...toolRest,
      available: "remote",
      renderAndWaitForResponse: render,
    },
    dependencies,
  );
}
