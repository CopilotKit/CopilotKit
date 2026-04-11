import React, { useEffect, useMemo, useRef } from "react";
import { ActionRenderProps, FrontendAction } from "../types/frontend-action";
import {
  Parameter,
  getZodParameters,
  MappedParameterTypes,
} from "@copilotkit/shared";
import { parseJson } from "@copilotkit/shared";
import { ToolCallStatus } from "@copilotkit/core";
import {
  type ReactFrontendTool,
  useFrontendTool as useFrontendToolVNext,
} from "../v2";

type FrontendToolOptions<T extends Parameter[] | []> = ReactFrontendTool<
  MappedParameterTypes<T>
>;
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
  const { name, description, parameters, render, followUp, available } = tool;
  const zodParameters = getZodParameters(parameters);

  const renderRef = useRef<typeof render>(render);

  const effectDeps = dependencies ?? [];

  useEffect(() => {
    renderRef.current = render;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [render, ...effectDeps]);

  const normalizedRender: FrontendToolOptions<T>["render"] | undefined =
    useMemo(() => {
      if (typeof render === "undefined") {
        return undefined;
      }

      return ((args: FrontendToolRenderArgs<T>) => {
        const currentRender = renderRef.current;

        if (typeof currentRender === "undefined") {
          return null;
        }

        if (typeof currentRender === "string") {
          return React.createElement(React.Fragment, null, currentRender);
        }

        const renderArgs = {
          ...args,
          result:
            typeof args.result === "string"
              ? parseJson(args.result, args.result)
              : args.result,
        } as ActionRenderProps<T>;

        const rendered = currentRender(renderArgs);

        if (typeof rendered === "string") {
          return React.createElement(React.Fragment, null, rendered);
        }

        return rendered ?? null;
      }) as FrontendToolOptions<T>["render"];
      // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally stable wrapper; delegates to renderRef
    }, []);

  // Handler ref to avoid stale closures
  const handlerRef = useRef<typeof tool.handler>(tool.handler);

  useEffect(() => {
    handlerRef.current = tool.handler;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool.handler, ...effectDeps]);

  const normalizedHandler = tool.handler
    ? (args: MappedParameterTypes<T>) => handlerRef.current?.(args)
    : undefined;

  useFrontendToolVNext<MappedParameterTypes<T>>({
    name,
    description,
    parameters: zodParameters,
    handler: normalizedHandler,
    followUp,
    render: normalizedRender,
    available: available === undefined ? undefined : available !== "disabled",
  });
}
