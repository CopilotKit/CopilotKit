import React, { useEffect, useMemo, useRef } from "react";
import type {
  ActionRenderProps,
  FrontendAction,
} from "../types/frontend-action";
import type { Parameter, MappedParameterTypes } from "@copilotkit/shared";
import { getZodParameters } from "@copilotkit/shared";
import { parseJson } from "@copilotkit/shared";
import type { ToolCallStatus } from "@copilotkit/core";
import { useFrontendTool as useFrontendToolVNext } from "../v2";
import type { ReactFrontendTool } from "../v2";

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

  // oxlint-disable react/exhaustive-deps -- intentional: spreading dynamic deps array; renderRef used to avoid stale closures
  useEffect(() => {
    renderRef.current = render;
  }, [render, ...(dependencies ?? [])]);
  // oxlint-enable react/exhaustive-deps

  const normalizedRender: FrontendToolOptions<T>["render"] | undefined =
    // oxlint-disable react/exhaustive-deps -- intentional: render accessed via renderRef to always use latest value without re-creating the wrapper
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
    }, []);
  // oxlint-enable react/exhaustive-deps

  // Handler ref to avoid stale closures
  const handlerRef = useRef<typeof tool.handler>(tool.handler);

  // oxlint-disable react/exhaustive-deps -- intentional: spreading dynamic deps array
  useEffect(() => {
    handlerRef.current = tool.handler;
  }, [tool.handler, ...(dependencies ?? [])]);
  // oxlint-enable react/exhaustive-deps

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
