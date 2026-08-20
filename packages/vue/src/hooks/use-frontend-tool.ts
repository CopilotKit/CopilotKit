/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/vue — useFrontendTool:
 *   V2 import and usage:
 *     import { useFrontendTool } from "@copilotkit/vue/v2";
 *     useFrontendTool({});
 *   V2 replacement source: packages/vue/src/v2/hooks/use-frontend-tool.ts
 *   V2 docs: https://docs.copilotkit.ai/reference/vue/hooks/useFrontendTool
 *
 * @copilotkit/vue — UseFrontendToolArgs:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/vue/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 * V1 source file: packages/vue/src/hooks/use-frontend-tool.ts
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

/**
 * V1 compatibility wrapper for useFrontendTool.
 *
 * Accepts the legacy Parameter[] format and converts to Zod via getZodParameters,
 * then delegates to the v2 composable.
 */
import type { WatchSource } from "vue";
import { getZodParameters, parseJson } from "@copilotkit/shared";
import type { Parameter, MappedParameterTypes } from "@copilotkit/shared";
import { useFrontendTool as useFrontendToolV2 } from "../v2/hooks/use-frontend-tool";
import type { VueFrontendTool } from "../v2/types";

export interface UseFrontendToolArgs<T extends Parameter[] | [] = []> {
  name: string;
  description?: string;
  parameters?: T;
  handler?: (args: MappedParameterTypes<T>) => unknown | Promise<unknown>;
  followUp?: boolean;
  available?: "disabled" | "enabled";
  render?: VueFrontendTool<MappedParameterTypes<T>>["render"];
  agentId?: string;
}

export function useFrontendTool<const T extends Parameter[] = []>(
  tool: UseFrontendToolArgs<T>,
  deps?: WatchSource<unknown>[],
) {
  const {
    name,
    description,
    parameters,
    handler,
    followUp,
    available,
    render,
    agentId,
  } = tool;
  const zodParameters = getZodParameters(parameters);

  // Wrap the v1 handler (single-arg) to match v2's (args, context) => Promise<unknown> signature
  const normalizedHandler = handler
    ? (args: MappedParameterTypes<T>) => Promise.resolve(handler(args))
    : undefined;

  // Wrap render to parse JSON-string results before passing them to the
  // user's render function — matches the v1 React behavior. If render is a
  // Component rather than a function, leave it unchanged.
  const normalizedRender =
    typeof render === "function"
      ? (props: { result?: unknown }) => {
          const renderProps =
            typeof props.result === "string"
              ? { ...props, result: parseJson(props.result, props.result) }
              : props;
          return (render as (p: unknown) => unknown)(renderProps);
        }
      : render;

  useFrontendToolV2<MappedParameterTypes<T>>(
    {
      name,
      description,
      parameters: zodParameters,
      handler: normalizedHandler,
      followUp,
      render: normalizedRender,
      available: available === undefined ? undefined : available !== "disabled",
      agentId,
    },
    deps,
  );
}
