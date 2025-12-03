import React from "react";
import { ActionRenderProps, FrontendAction } from "../types/frontend-action";
import { Parameter, getZodParameters, MappedParameterTypes } from "@copilotkit/shared";
import { parseJson } from "@copilotkit/shared";
import { ToolCallStatus } from "@copilotkitnext/core";
import {
  type ReactFrontendTool,
  useFrontendTool as useFrontendToolVNext,
} from "@copilotkitnext/react";

type FrontendToolOptions<T extends Parameter[] | []> = ReactFrontendTool<MappedParameterTypes<T>>;
type FrontendToolRenderArgs<T extends Parameter[] | []> =
  | {
      name: string;
      args: Partial<MappedParameterTypes<T>>;
      status: ToolCallStatus.InProgress;
      result: undefined;
    }
  | {
      name: string;
      args: MappedParameterTypes<T>;
      status: ToolCallStatus.Executing;
      result: undefined;
    }
  | {
      name: string;
      args: MappedParameterTypes<T>;
      status: ToolCallStatus.Complete;
      result: string;
    };

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

  const normalizedRender: FrontendToolOptions<T>["render"] | undefined = (() => {
    if (typeof render === "undefined") {
      return undefined;
    }

    if (typeof render === "string") {
      const staticRender = render;
      return (() =>
        React.createElement(
          React.Fragment,
          null,
          staticRender,
        )) as FrontendToolOptions<T>["render"];
    }

    return ((args: FrontendToolRenderArgs<T>) => {
      const renderArgs = {
        ...args,
        result: typeof args.result === "string" ? parseJson(args.result, args.result) : args.result,
      } as ActionRenderProps<T>;

      const rendered = render(renderArgs);

      if (typeof rendered === "string") {
        return React.createElement(React.Fragment, null, rendered);
      }

      return rendered ?? null;
    }) as FrontendToolOptions<T>["render"];
  })();

  useFrontendToolVNext<MappedParameterTypes<T>>({
    name,
    description,
    parameters: zodParameters,
    handler: tool.handler,
    followUp,
    render: normalizedRender,
  });
}
