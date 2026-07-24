/**
 * V1 compatibility wrapper for `useFrontendTool`.
 *
 * Accepts the legacy `Parameter[]` format and preserves the React v1 handler,
 * dependency, result, and render normalization before delegating to Vue v2.
 *
 * @example
 * ```ts
 * useFrontendTool({
 *   name: "sayHello",
 *   parameters: [{ name: "name", type: "string" }],
 *   handler: ({ name }) => `Hello, ${name}`,
 * });
 * ```
 */
import { h } from "vue";
import type { WatchSource, VNodeChild, Component } from "vue";
import type { MappedParameterTypes, Parameter } from "@copilotkit/shared";
import { getZodParameters, parseJson } from "@copilotkit/shared";
import { useFrontendTool as useFrontendToolV2 } from "../v2/hooks/use-frontend-tool";
import type { FrontendActionRender } from "./use-copilot-action";
import type { VueToolCallRendererRenderProps } from "../v2/types";

export interface UseFrontendToolArgs<T extends Parameter[] | [] = []> {
  name: string;
  description?: string;
  parameters?: T;
  handler?: (args: MappedParameterTypes<T>) => unknown | Promise<unknown>;
  followUp?: boolean;
  available?: "disabled" | "enabled";
  render?: FrontendActionRender<T>;
}

type LegacyUseFrontendToolArgs<T extends Parameter[] | []> = Omit<
  UseFrontendToolArgs<T>,
  "render"
> & {
  render: (
    props: VueToolCallRendererRenderProps<MappedParameterTypes<T>>,
  ) => VNodeChild;
};

type AnyUseFrontendToolArgs<T extends Parameter[] | []> =
  | UseFrontendToolArgs<T>
  | LegacyUseFrontendToolArgs<T>;

type NormalizedRender =
  | ((props: { result?: unknown }) => VNodeChild | null)
  | Component;

function normalizeLatestRender<T extends Parameter[] | []>(
  tool: AnyUseFrontendToolArgs<T>,
): NormalizedRender {
  return (props: { result?: unknown }) => {
    const render = tool.render;
    if (typeof render === "undefined") return null;
    if (typeof render === "string") return render;
    const renderProps =
      typeof props.result === "string"
        ? { ...props, result: parseJson(props.result, props.result) }
        : props;
    if (typeof render === "function") {
      return (render as (props: unknown) => VNodeChild)(renderProps) ?? null;
    }
    return h(render as Component, renderProps);
  };
}

export function useFrontendTool<const T extends Parameter[] | [] = []>(
  tool: UseFrontendToolArgs<T>,
  dependencies?: WatchSource<unknown>[],
): void;
export function useFrontendTool<const T extends Parameter[] | [] = []>(
  tool: LegacyUseFrontendToolArgs<T>,
  dependencies?: WatchSource<unknown>[],
): void;
export function useFrontendTool<const T extends Parameter[] | [] = []>(
  tool: AnyUseFrontendToolArgs<T>,
  dependencies?: WatchSource<unknown>[],
): void {
  const normalizedRender = normalizeLatestRender(tool);
  const normalizedHandler = (args: MappedParameterTypes<T>) =>
    tool.handler?.(args);

  // Keep the adapter live so dependency-triggered Vue registrations observe
  // the current v1 action fields, just as React reads the latest render's
  // configuration. The v2 hook reads these getters when it re-registers.
  const registeredTool = {
    get name() {
      return tool.name;
    },
    get description() {
      return tool.description;
    },
    get parameters() {
      return getZodParameters(tool.parameters);
    },
    get handler() {
      return tool.handler ? normalizedHandler : undefined;
    },
    get followUp() {
      return tool.followUp;
    },
    get render() {
      return tool.render === undefined ? undefined : normalizedRender;
    },
    get available() {
      return tool.available === undefined
        ? undefined
        : tool.available !== "disabled";
    },
  };

  useFrontendToolV2<MappedParameterTypes<T>>(
    registeredTool as never,
    dependencies,
  );
}
