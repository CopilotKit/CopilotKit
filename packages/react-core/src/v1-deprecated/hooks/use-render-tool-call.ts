/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-core — useRenderToolCall:
 *   V2 import and usage:
 *     import { useRenderTool } from "@copilotkit/react-core/v2";
 *     import { z } from "zod";
 *
 *     function StatusTool() {
 *       useRenderTool({
 *         name: "showStatus",
 *         parameters: z.object({}),
 *         render: ({ status, result }) => (
 *           <div>{status === "complete" ? result : "Running..."}</div>
 *         ),
 *       });
 *       return null;
 *     }
 *   V2 replacement source: packages/react-core/src/v2/hooks/use-render-tool.tsx
 *   V2 docs: https://docs.copilotkit.ai/reference/v2/hooks/useRenderTool
 *   Migration note: Use useRenderTool to register a renderer for an existing backend tool in v2.
 *   Migration note: The v2 hook named useRenderToolCall is a different, low-level consumer API.
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import { getZodParameters } from "@copilotkit/shared";
import type { Parameter } from "@copilotkit/shared";
import { parseJson } from "@copilotkit/shared";
import { defineToolCallRenderer, useCopilotKit } from "../../v2";
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

/**
 * @deprecated The v1 SDK is deprecated. Use v2 instead. Use `useRenderTool` from `@copilotkit/react-core/v2` instead.
 *
 * ```tsx
 * import { useRenderTool } from "@copilotkit/react-core/v2";
 * import { z } from "zod";
 *
 * function StatusTool() {
 *   useRenderTool({
 *     name: "showStatus",
 *     parameters: z.object({}),
 *     render: ({ status, result }) => (
 *       <div>{status === "complete" ? result : "Running..."}</div>
 *     ),
 *   });
 *   return null;
 * }
 * ```
 * See https://docs.copilotkit.ai/reference/v2/hooks/useRenderTool
 */
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
