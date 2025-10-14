import { useCopilotAction } from "./use-copilot-action";
import { FrontendAction } from "../types";
import { Parameter } from "@copilotkit/shared";
import {
  ReactHumanInTheLoop,
  useHumanInTheLoop as useHumanInTheLoopVNext,
} from "@copilotkitnext/react";
import { getZodParameters } from "../utils/utils";
import { z } from "zod/index";

type UseToolCallArgs<T extends Parameter[] | [] = []> = {
  available?: "disabled" | "enabled";
  render: FrontendAction<T>["renderAndWaitForResponse"];
  followUp?: FrontendAction<T>["followUp"];
} & Pick<FrontendAction<T>, "name" | "description" | "parameters">;

export function useHumanInTheLoop<const T extends Parameter[] | [] = []>(
  tool: UseToolCallArgs<T>,
  dependencies?: any[],
) {
  const { render, ...toolRest } = tool;

  const { name, description, parameters, followUp } = toolRest

  const zodParameters = getZodParameters(parameters)

  useHumanInTheLoopVNext({
    name,
    description,
    parameters: zodParameters,
    render: render as unknown as ReactHumanInTheLoop<any>["render"],
    followUp,
  });

  useCopilotAction(
    {
      ...toolRest,
      available: tool.available === "disabled" ? tool.available : "remote",
      renderAndWaitForResponse: render,
    },
    dependencies,
  );
}
