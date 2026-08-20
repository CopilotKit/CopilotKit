/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-core — useFrontendTool:
 *   V2 import and usage:
 *     import { useFrontendTool } from "@copilotkit/react-core/v2";
 *     import { z } from "zod";
 *
 *     function MyComponent() {
 *       useFrontendTool({
 *         name: "myTool",
 *         description: "Run my tool",
 *         parameters: z.object({}),
 *         handler: async () => "done",
 *       });
 *       return null;
 *     }
 *   V2 replacement source: packages/react-core/src/v2/hooks/use-frontend-tool.tsx
 *   V2 docs: https://docs.copilotkit.ai/reference/v2/hooks/useFrontendTool
 *   Migration note: The v2 API uses a Zod schema instead of the v1 Parameter[] shape.
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

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
} from "../../v2";

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

/**
 * @deprecated The v1 SDK is deprecated. Use v2 instead. Use `useFrontendTool` from `@copilotkit/react-core/v2` instead.
 *
 * ```tsx
 * import { useFrontendTool } from "@copilotkit/react-core/v2";
 * import { z } from "zod";
 *
 * function MyComponent() {
 *   useFrontendTool({
 *     name: "myTool",
 *     description: "Run my tool",
 *     parameters: z.object({}),
 *     handler: async () => "done",
 *   });
 *   return null;
 * }
 * ```
 * See https://docs.copilotkit.ai/reference/v2/hooks/useFrontendTool
 */
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
