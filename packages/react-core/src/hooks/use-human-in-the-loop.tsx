import { useCopilotKit } from "../context";
import type { ReactFrontendTool } from "../types/frontend-tool";
import type { ReactHumanInTheLoop } from "../types/human-in-the-loop";
import type { ReactToolCallRenderer } from "../types/react-tool-call-renderer";
import { ɵbuildHumanInTheLoopTool, ɵhitlRenderProps } from "@copilotkit/core";
import { useCallback, useLayoutEffect } from "react";
import React from "react";
import { useFrontendTool } from "./use-frontend-tool";

export function useHumanInTheLoop<
  T extends Record<string, unknown> = Record<string, unknown>,
>(tool: ReactHumanInTheLoop<T>, deps?: ReadonlyArray<unknown>) {
  const { copilotkit } = useCopilotKit();
  // Core parks each call by tool call id, so parallel calls of this tool
  // (or of a "*" catch-all) each get their own `respond`.
  const registry = copilotkit.ɵhumanInTheLoop;

  const RenderComponent: ReactToolCallRenderer<T>["render"] = useCallback(
    (props) =>
      React.createElement(
        tool.render,
        ɵhitlRenderProps<T, typeof props>(props, tool, registry),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tool is a fresh object each render; depend on the fields the renderer reads
    [tool.render, tool.name, tool.description, tool.agentId, registry],
  );

  const frontendTool: ReactFrontendTool<T> = {
    ...ɵbuildHumanInTheLoopTool<T>(tool, registry),
    render: RenderComponent,
  };

  useFrontendTool(frontendTool, deps);

  // Human-in-the-loop tools should remove their renderer on unmount
  // since they can't respond to user interactions anymore.
  //
  // This MUST stay a layout effect to match `useFrontendTool`, which registers
  // the renderer in its own layout effect. React runs every cleanup in a phase
  // before any effect of that same phase, but it runs the whole layout phase
  // ahead of the whole passive phase. If this teardown were passive while the
  // registration is layout, a keyed remount would order the outgoing
  // instance's removal *after* the incoming instance's registration and delete
  // the renderer that had just been added, leaving the tool unrenderable.
  useLayoutEffect(() => {
    return () => {
      copilotkit.removeHookRenderToolCall(tool.name, tool.agentId);
    };
  }, [copilotkit, tool.name, tool.agentId]);
}
