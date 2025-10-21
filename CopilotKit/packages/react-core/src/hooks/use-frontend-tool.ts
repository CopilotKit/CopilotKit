import { ActionRenderProps, FrontendAction } from "../types/frontend-action";
import { Parameter, getZodParameters } from "@copilotkit/shared";
import { useFrontendTool as useFrontendToolVNext } from "@copilotkitnext/react";
import { parseJson } from "@copilotkit/shared";

export type UseFrontendToolArgs<T extends Parameter[] | [] = []> = {
  available?: "disabled" | "enabled";
} & Pick<
  FrontendAction<T>,
  "name" | "description" | "parameters" | "handler" | "followUp" | "render"
>;

export function useFrontendTool<const T extends Parameter[] = []>(
  tool: UseFrontendToolArgs<T>,
  dependencies?: any[],
) {
  const { name, description, parameters, render, followUp } = tool;
  const zodParameters = getZodParameters(parameters);

  useFrontendToolVNext({
    name,
    description,
    parameters: zodParameters,
    handler: tool.handler,
    followUp,
    render: (args) => {
      if (typeof render === "string") return render;
      return render?.({
        ...args,
        result: args.result ? parseJson(args.result, args.result) : args.result,
      });
    },
  });
}
