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
import React, { ComponentType, FunctionComponent, useEffect, useRef } from "react";

type HumanInTheLoopOptions = Parameters<typeof useHumanInTheLoopVNext>[0];
type HumanInTheLoopRender = HumanInTheLoopOptions["render"];
type HumanInTheLoopRenderArgs = HumanInTheLoopRender extends (props: infer P) => any ? P : never;

export type UseHumanInTheLoopArgs<T extends Parameter[] | [] = []> = {
  available?: "disabled" | "enabled";
  render: FrontendAction<T>["renderAndWaitForResponse"];
  followUp?: FrontendAction<T>["followUp"];
} & Pick<FrontendAction<T>, "name" | "description" | "parameters">;

type HitlRendererArgs =
  | {
      name: string;
      description: string;
      args: Partial<Record<string, unknown>>;
      status: ToolCallStatus.InProgress;
      result: undefined;
      respond: undefined;
    }
  | {
      name: string;
      description: string;
      args: Record<string, unknown>;
      status: ToolCallStatus.Executing;
      result: undefined;
      respond: (result: unknown) => Promise<void>;
    }
  | {
      name: string;
      description: string;
      args: Record<string, unknown>;
      status: ToolCallStatus.Complete;
      result: string;
      respond: undefined;
    };
type HitlRenderer = FunctionComponent<HitlRendererArgs>;

export function useHumanInTheLoop<const T extends Parameter[] | [] = []>(
  tool: UseHumanInTheLoopArgs<T>,
  dependencies?: any[],
) {
  const { render, ...toolRest } = tool;
  const { name, description, parameters, followUp } = toolRest;
  const zodParameters = getZodParameters(parameters);
  const renderRef = useRef<HitlRenderer | null>(null);

  useEffect(() => {
    renderRef.current = (args: HitlRendererArgs): React.ReactElement | null => {
      if (typeof render === "string") {
        return React.createElement(React.Fragment, null, render);
      }

      if (!render) {
        return null;
      }

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

      const rendered = render(renderProps);

      if (typeof rendered === "string") {
        return React.createElement(React.Fragment, null, rendered);
      }

      return rendered ?? null;
    };
  }, [render, ...(dependencies ?? [])]);

  useHumanInTheLoopVNext({
    name,
    description,
    followUp,
    parameters: zodParameters,
    render: ((args: HumanInTheLoopRenderArgs) =>
      renderRef.current?.(args as HitlRendererArgs) ?? null) as HumanInTheLoopOptions["render"],
  });
}
