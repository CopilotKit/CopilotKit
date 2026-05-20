/**
 * V1 compatibility wrapper for useFrontendTool.
 *
 * Accepts the legacy Parameter[] format and converts to Zod via getZodParameters,
 * then delegates to the v2 composable.
 */
import type { WatchSource } from "vue";
import {
  type Parameter,
  type MappedParameterTypes,
  getZodParameters,
  parseJson,
} from "@copilotkit/shared";
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
