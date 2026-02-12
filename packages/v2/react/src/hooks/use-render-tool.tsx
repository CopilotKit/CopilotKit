import { useEffect } from "react";
import type { z } from "zod";
import { useCopilotKit } from "../providers/CopilotKitProvider";
import { defineToolCallRenderer } from "../types/defineToolCallRenderer";
import type { ReactToolCallRenderer } from "../types/react-tool-call-renderer";

const EMPTY_DEPS: ReadonlyArray<unknown> = [];

export interface RenderToolInProgressProps<S extends z.ZodTypeAny> {
  name: string;
  args: Partial<z.infer<S>>;
  status: "inProgress";
  result: undefined;
}

export interface RenderToolExecutingProps<S extends z.ZodTypeAny> {
  name: string;
  args: z.infer<S>;
  status: "executing";
  result: undefined;
}

export interface RenderToolCompleteProps<S extends z.ZodTypeAny> {
  name: string;
  args: z.infer<S>;
  status: "complete";
  result: string;
}

export type RenderToolProps<S extends z.ZodTypeAny> =
  | RenderToolInProgressProps<S>
  | RenderToolExecutingProps<S>
  | RenderToolCompleteProps<S>;

type RenderToolConfig<S extends z.ZodTypeAny> = {
  name: string;
  args?: S;
  render: (props: RenderToolProps<S>) => React.ReactElement;
  agentId?: string;
};

// Overload: wildcard without args
export function useRenderTool(
  config: {
    name: "*";
    render: (props: any) => React.ReactElement;
    agentId?: string;
  },
  deps?: ReadonlyArray<unknown>,
): void;

// Overload: named tool with args
export function useRenderTool<S extends z.ZodTypeAny>(
  config: {
    name: string;
    args: S;
    render: (props: RenderToolProps<S>) => React.ReactElement;
    agentId?: string;
  },
  deps?: ReadonlyArray<unknown>,
): void;

// Implementation
export function useRenderTool<S extends z.ZodTypeAny>(
  config: RenderToolConfig<S>,
  deps?: ReadonlyArray<unknown>,
): void {
  const { copilotkit } = useCopilotKit();
  const extraDeps = deps ?? EMPTY_DEPS;

  useEffect(() => {
    // Build the ReactToolCallRenderer via defineToolCallRenderer
    const renderer =
      config.name === "*" && !config.args
        ? defineToolCallRenderer({
            name: "*",
            render: config.render as any,
            ...(config.agentId ? { agentId: config.agentId } : {}),
          })
        : defineToolCallRenderer({
            name: config.name,
            args: config.args!,
            render: config.render as any,
            ...(config.agentId ? { agentId: config.agentId } : {}),
          });

    // Dedupe by "agentId:name" key, same pattern as useFrontendTool
    const keyOf = (rc: ReactToolCallRenderer<any>) =>
      `${rc.agentId ?? ""}:${rc.name}`;
    const currentRenderToolCalls =
      copilotkit.renderToolCalls as ReactToolCallRenderer<any>[];

    const mergedMap = new Map<string, ReactToolCallRenderer<any>>();
    for (const rc of currentRenderToolCalls) {
      mergedMap.set(keyOf(rc), rc);
    }

    mergedMap.set(keyOf(renderer), renderer);

    copilotkit.setRenderToolCalls(Array.from(mergedMap.values()));

    // No cleanup removal — keeps renderer for chat history, same as useFrontendTool
  }, [config.name, copilotkit, extraDeps.length, ...extraDeps]);
}
