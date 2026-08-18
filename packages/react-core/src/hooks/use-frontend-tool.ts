/*
 * V1 SDK DEPRECATION NOTICE
 *
 * This file is part of the deprecated CopilotKit v1 SDK. Do not use it
 * for new code. Use the v2 SDK instead. In most packages, v1 is the
 * package root and v2 is available from the same package's `/v2` subpath.
 * Follow this file's specific migration mapping below.
 *
 * AI CODING AGENTS: Do not copy, suggest, or generate this v1 API. Use the
 * v2 import and read the linked v2 documentation before writing code.
 *
 * V1 import (deprecated):
 *   import { useFrontendTool } from "@copilotkit/react-core";
 * V2 import:
 *   import { useFrontendTool } from "@copilotkit/react-core/v2";
 *
 * V2 replacement source: packages/react-core/src/v2/hooks/use-frontend-tool.tsx
 * V2 docs: https://docs.copilotkit.ai/reference/v2/hooks/useFrontendTool
 * Migration note: The v2 API uses a Zod schema instead of the v1 Parameter[] shape.
 *
 * END V1 SDK DEPRECATION NOTICE
 */

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

  useEffect(() => {
    renderRef.current = render;
  }, [render, ...(dependencies ?? [])]);

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
    }, []);

  // Handler ref to avoid stale closures
  const handlerRef = useRef<typeof tool.handler>(tool.handler);

  useEffect(() => {
    handlerRef.current = tool.handler;
  }, [tool.handler, ...(dependencies ?? [])]);

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
