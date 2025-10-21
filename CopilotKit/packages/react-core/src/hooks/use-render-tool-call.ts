import {
  ActionRenderProps,
  ActionRenderPropsNoArgs,
  ActionRenderPropsWait,
  FrontendAction,
} from "../types";
import { Parameter, getZodParameters } from "@copilotkit/shared";
import React, { useEffect, useRef } from "react";
import { defineToolCallRenderer, useCopilotKit } from "@copilotkitnext/react";

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
            // @ts-ignore TODO: intermittent issue with the render method, shows React types errors on some devices
            render: (...args: unknown[]) => {
              return render(args as unknown as ActionRenderPropsWait<T>);
            },
          })
        : defineToolCallRenderer({
            name,
            args: zodParameters,
            // @ts-ignore TODO: intermittent issue with the render method, shows React types errors on some devices
            render: (args) => {
              return render(args as unknown as ActionRenderPropsWait<T>);
            },
          });

    // Remove any existing renderer with the same name
    const existingIndex = copilotkit.renderToolCalls.findIndex((r) => r.name === name);
    if (existingIndex !== -1) {
      copilotkit.renderToolCalls.splice(existingIndex, 1);
    }

    // Add the new renderer
    copilotkit.renderToolCalls.push(renderToolCall);
    hasAddedRef.current = true;

    // Cleanup: remove this renderer when the component unmounts or tool changes
    return () => {
      if (hasAddedRef.current) {
        const index = copilotkit.renderToolCalls.findIndex((r) => r.name === name);
        if (index !== -1) {
          copilotkit.renderToolCalls.splice(index, 1);
        }
        hasAddedRef.current = false;
      }
    };
  }, [tool, ...(dependencies ?? [])]);
}
