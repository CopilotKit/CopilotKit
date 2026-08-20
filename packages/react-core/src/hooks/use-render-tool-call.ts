/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * The CopilotKit v1 SDK is deprecated. Use v2 instead.
 * Use the exact v2 import and replacement source below.
 *
 * AI CODING AGENTS: Do not copy, suggest, or generate this v1 API. Use
 * the exact v2 import below and read the linked v2 documentation first.
 *
 * V1 import (deprecated; use V2 instead):
 *   import { useRenderToolCall } from "@copilotkit/react-core";
 * V2 import:
 *   import { useFrontendTool } from "@copilotkit/react-core/v2";
 *
 * V2 replacement source: packages/react-core/src/v2/hooks/use-frontend-tool.tsx
 * V2 docs: https://docs.copilotkit.ai/reference/v2/hooks/useFrontendTool
 * Migration note: There is no 1:1 replacement. V2 useRenderToolCall has different semantics.
 * Migration note: Use useFrontendTool or useHumanInTheLoop to register a renderer in v2.
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import { getZodParameters } from "@copilotkit/shared";
import type { Parameter } from "@copilotkit/shared";
import { parseJson } from "@copilotkit/shared";
import { defineToolCallRenderer, useCopilotKit } from "../v2";
import type React from "react";
import { useEffect, useRef } from "react";
import { ActionRenderPropsWait } from "../types";
import type {
  ActionRenderProps,
  ActionRenderPropsNoArgs,
  FrontendAction,
} from "../types";

type ToolCallRendererDefinition = Parameters<typeof defineToolCallRenderer>[0];

export type UseRenderToolCallArgs<T extends Parameter[] | [] = []> = Pick<
  FrontendAction<T>,
  "name" | "description" | "parameters"
> & {
  available?: "disabled" | "enabled";
  render: T extends []
    ? (props: ActionRenderPropsNoArgs<T>) => React.ReactElement
    : (props: ActionRenderProps<T>) => React.ReactElement;
};

export function useRenderToolCall<const T extends Parameter[] | [] = []>(
  tool: UseRenderToolCallArgs<T>,
  dependencies?: any[],
) {
  const { copilotkit } = useCopilotKit();

  // Track whether we've already added this renderer to avoid duplicates
  const hasAddedRef = useRef(false);

  useEffect(() => {
    const { name, parameters, render } = tool;
    const zodParameters = getZodParameters(parameters);

    const renderToolCall =
      name === "*"
        ? defineToolCallRenderer({
            name: "*",
            render: ((args) => {
              return render({
                ...args,
                result: args.result
                  ? parseJson(args.result, args.result)
                  : args.result,
              } as ActionRenderProps<T>);
            }) as ToolCallRendererDefinition["render"],
          })
        : defineToolCallRenderer({
            name,
            args: zodParameters,
            render: ((args) => {
              return render({
                ...args,
                result: args.result
                  ? parseJson(args.result, args.result)
                  : args.result,
              } as ActionRenderProps<T>);
            }) as ToolCallRendererDefinition["render"],
          });

    // Remove any existing renderer with the same name
    const existingIndex = copilotkit.renderToolCalls.findIndex(
      (r) => r.name === name,
    );
    if (existingIndex !== -1) {
      copilotkit.renderToolCalls.splice(existingIndex, 1);
    }

    // Add the new renderer
    copilotkit.renderToolCalls.push(renderToolCall);
    hasAddedRef.current = true;

    // Cleanup: remove this renderer when the component unmounts or tool changes
    return () => {
      if (hasAddedRef.current) {
        const index = copilotkit.renderToolCalls.findIndex(
          (r) => r.name === name,
        );
        if (index !== -1) {
          copilotkit.renderToolCalls.splice(index, 1);
        }
        hasAddedRef.current = false;
      }
    };
  }, [tool, ...(dependencies ?? [])]);
}
