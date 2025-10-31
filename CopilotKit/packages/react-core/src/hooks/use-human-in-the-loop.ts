import { ActionRenderProps, ActionRenderPropsWait, FrontendAction } from "../types";
import {
  CopilotKitError,
  CopilotKitErrorCode,
  MappedParameterTypes,
  Parameter,
  getZodParameters,
  parseJson,
} from "@copilotkit/shared";
import { useHumanInTheLoop as useHumanInTheLoopVNext } from "@copilotkitnext/react";
import { ToolCallStatus } from "@copilotkitnext/core";

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
    followUp,
    parameters: zodParameters,
    render: (args) => {
      if (typeof render === "string") return render;

      const renderProps: ActionRenderPropsWait<T> = (() => {
        const mappedArgs = args.args as unknown as MappedParameterTypes<T>;

        switch (args.status) {
          case ToolCallStatus.InProgress:
            return {
              args: mappedArgs,
              respond: args.respond,
              status: args.status,
              handler: undefined,
            };
          case ToolCallStatus.Executing:
            return {
              args: mappedArgs,
              respond: args.respond,
              status: args.status,
              handler: () => {},
            };
          case ToolCallStatus.Complete:
            return {
              args: mappedArgs,
              respond: args.respond,
              status: args.status,
              result: args.result ? parseJson(args.result, args.result) : args.result,
              handler: undefined,
            };
          default:
            throw new CopilotKitError({
              code: CopilotKitErrorCode.UNKNOWN,
              message: `Invalid tool call status: ${(args as unknown as { status: string }).status}`,
            });
        }
      })();

      return render?.(renderProps);
    },
  });
}
