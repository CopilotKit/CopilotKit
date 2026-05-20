/**
 * V1 compatibility wrapper for useCopilotAction.
 *
 * Accepts the legacy Parameter[] action format and routes to the appropriate
 * v2 composable (useFrontendTool, useHumanInTheLoop, or useRenderTool).
 */
import type { WatchSource } from "vue";
import type { Parameter, MappedParameterTypes } from "@copilotkit/shared";
import { getZodParameters, parseJson } from "@copilotkit/shared";
import { useFrontendTool as useFrontendToolV2 } from "../v2/hooks/use-frontend-tool";
import { useHumanInTheLoop as useHumanInTheLoopV2 } from "../v2/hooks/use-human-in-the-loop";
import { useRenderTool as useRenderToolV2 } from "../v2/hooks/use-render-tool";
import type { VueFrontendTool, VueHumanInTheLoop } from "../v2/types";

// Wraps a v1 render function so a JSON-string `result` is parsed before being
// passed through. Mirrors the v1 React behavior. If render is a Component
// (object) rather than a function, returns it unchanged — Components receive
// props through Vue's prop system and the user is responsible for parsing.
function wrapRenderWithJsonResult<R>(render: R): R {
  if (typeof render !== "function") return render;
  return ((props: { result?: unknown }) => {
    const next =
      typeof props.result === "string"
        ? { ...props, result: parseJson(props.result, props.result) }
        : props;
    return (render as (p: unknown) => unknown)(next);
  }) as R;
}

export interface FrontendAction<T extends Parameter[] | [] = []> {
  name: string;
  description?: string;
  parameters?: T;
  handler?: (args: MappedParameterTypes<T>) => unknown | Promise<unknown>;
  followUp?: boolean;
  available?: "disabled" | "enabled" | "remote" | "frontend";
  render?: VueFrontendTool<MappedParameterTypes<T>>["render"];
  renderAndWaitForResponse?: VueFrontendTool<MappedParameterTypes<T>>["render"];
  renderAndWait?: VueFrontendTool<MappedParameterTypes<T>>["render"];
  agentId?: string;
}

export interface CatchAllFrontendAction {
  name: "*";
  render: (props: unknown) => unknown;
}

export function useCopilotAction<const T extends Parameter[] | [] = []>(
  action: FrontendAction<T> | CatchAllFrontendAction,
  deps?: WatchSource<unknown>[],
): void {
  const zodParameters =
    "parameters" in action
      ? getZodParameters(action.parameters as T)
      : undefined;

  // Catch-all render action
  if (action.name === "*") {
    useRenderToolV2(
      {
        name: "*",
        render: wrapRenderWithJsonResult(
          (action as CatchAllFrontendAction).render,
        ),
        ...("agentId" in action
          ? { agentId: (action as FrontendAction<T>).agentId }
          : {}),
      },
      deps,
    );
    return;
  }

  const typedAction = action as FrontendAction<T>;

  // Human-in-the-loop: has renderAndWaitForResponse or renderAndWait
  if (
    "renderAndWaitForResponse" in typedAction ||
    "renderAndWait" in typedAction
  ) {
    const render =
      typedAction.render ??
      typedAction.renderAndWaitForResponse ??
      typedAction.renderAndWait;

    if (!render) {
      console.warn(
        `[CopilotKit] useCopilotAction: HITL action '${typedAction.name}' ` +
          `has no render function. Skipping.`,
      );
      return;
    }

    useHumanInTheLoopV2<MappedParameterTypes<T>>(
      {
        name: typedAction.name,
        description: typedAction.description,
        parameters: zodParameters,
        render: wrapRenderWithJsonResult(render) as VueHumanInTheLoop<
          MappedParameterTypes<T>
        >["render"],
        agentId: typedAction.agentId,
      },
      deps,
    );
    return;
  }

  // Render-only: available is "frontend" or "disabled" (no handler invoked remotely)
  if (
    typedAction.available === "frontend" ||
    typedAction.available === "disabled"
  ) {
    if (typedAction.render && zodParameters) {
      useRenderToolV2(
        {
          name: typedAction.name,
          parameters: zodParameters,
          render: wrapRenderWithJsonResult(
            typedAction.render as (props: unknown) => unknown,
          ),
          agentId: typedAction.agentId,
        },
        deps,
      );
    } else {
      console.warn(
        `[CopilotKit] useCopilotAction: action '${typedAction.name}' ` +
          `with available="${typedAction.available}" requires both ` +
          `'render' and 'parameters'. Skipping registration.`,
      );
    }
    return;
  }

  // Default: frontend tool with handler
  // Wrap the v1 handler (single-arg) to match v2's (args, context) => Promise<unknown> signature
  const normalizedHandler = typedAction.handler
    ? (args: MappedParameterTypes<T>) =>
        Promise.resolve(typedAction.handler!(args))
    : undefined;

  // Convert v1 available (string enum) to v2 available (boolean)
  // At this point, "frontend" and "disabled" have been handled above,
  // so remaining values are "enabled", "remote", or undefined.
  // "remote" means server-only: register the tool but mark it as not
  // available on the frontend (matches React's ActionInputAvailability.Remote).
  let normalizedAvailable: boolean | undefined;
  if (typedAction.available === "remote") {
    normalizedAvailable = false;
  } else if (typedAction.available !== undefined) {
    normalizedAvailable = true;
  }

  useFrontendToolV2<MappedParameterTypes<T>>(
    {
      name: typedAction.name,
      description: typedAction.description,
      parameters: zodParameters,
      handler: normalizedHandler,
      followUp: typedAction.followUp,
      render: wrapRenderWithJsonResult(typedAction.render),
      available: normalizedAvailable,
      agentId: typedAction.agentId,
    },
    deps,
  );
}
