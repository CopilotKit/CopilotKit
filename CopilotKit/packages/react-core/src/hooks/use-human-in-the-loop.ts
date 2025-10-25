import { ActionRenderPropsWait, FrontendAction } from "../types";
import { Parameter, getZodParameters } from "@copilotkit/shared";
import { useHumanInTheLoop as useHumanInTheLoopVNext } from "@copilotkitnext/react";
import { parseJson } from "@copilotkit/shared";

export type UseHumanInTheLoopArgs<T extends Parameter[] | [] = []> = {
  available?: "disabled" | "enabled";
  render: FrontendAction<T>["renderAndWaitForResponse"];
  followUp?: FrontendAction<T>["followUp"];
} & Pick<FrontendAction<T>, "name" | "description" | "parameters">;

export function useHumanInTheLoop<const T extends Parameter[] | [] = []>(
  tool: UseHumanInTheLoopArgs<T>,
  dependencies?: any[],
) {
  const { render, ...toolRest } = tool;

  const { name, description, parameters, followUp } = toolRest;

  const zodParameters = getZodParameters(parameters);

  useHumanInTheLoopVNext({
    name,
    description,
    parameters: zodParameters,
    // @ts-ignore TODO: intermittent issue with the render method, shows React types errors on some devices
    render: (args) => {
      if (typeof render === "string") return render;
      console.log("render HITL", args);
      return render?.({
        ...args,
        result: args.result ? parseJson(args.result, args.result) : args.result,
      } as unknown as ActionRenderPropsWait<T>);
    },
    followUp,
  });
}
