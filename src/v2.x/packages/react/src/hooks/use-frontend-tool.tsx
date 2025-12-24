import { useEffect } from "react";
import { useCopilotKit } from "../providers/CopilotKitProvider";
import { ReactFrontendTool } from "../types/frontend-tool";
import { ReactToolCallRenderer } from "../types/react-tool-call-renderer";
import { DEFINED_IN_MIDDLEWARE_EXPERIMENTAL } from "@copilotkitnext/core";
import { z } from "zod";

const EMPTY_DEPS: ReadonlyArray<unknown> = [];

export function useFrontendTool<
  T extends Record<string, unknown> = Record<string, unknown>,
>(tool: ReactFrontendTool<T>, deps?: ReadonlyArray<unknown>) {
  const { copilotkit } = useCopilotKit();
  const extraDeps = deps ?? EMPTY_DEPS;

  useEffect(() => {
    const name = tool.name;

    // Always register/override the tool for this name on mount
    if (copilotkit.getTool({ toolName: name, agentId: tool.agentId })) {
      console.warn(
        `Tool '${name}' already exists for agent '${tool.agentId || 'global'}'. Overriding with latest registration.`
      );
      copilotkit.removeTool(name, tool.agentId);
    }
    copilotkit.addTool(tool);

    // Register/override renderer by name and agentId through core
    if (tool.render) {
      // Get current render tool calls and merge with new entry
      const keyOf = (rc: ReactToolCallRenderer<any>) => `${rc.agentId ?? ""}:${rc.name}`;
      const currentRenderToolCalls = copilotkit.renderToolCalls as ReactToolCallRenderer<any>[];

      // Build map from existing entries
      const mergedMap = new Map<string, ReactToolCallRenderer<any>>();
      for (const rc of currentRenderToolCalls) {
        mergedMap.set(keyOf(rc), rc);
      }

      // Use z.any() as fallback when parameters is DEFINED_IN_MIDDLEWARE_EXPERIMENTAL
      // The actual schema comes from the server, but we still need to register the renderer
      const args = tool.parameters === DEFINED_IN_MIDDLEWARE_EXPERIMENTAL
        ? z.any()
        : (tool.parameters ?? z.any());

      // Add/overwrite with new entry
      const newEntry = {
        name,
        args,
        agentId: tool.agentId,
        render: tool.render,
      } as ReactToolCallRenderer<any>;
      mergedMap.set(keyOf(newEntry), newEntry);

      // Set the merged list back
      copilotkit.setRenderToolCalls(Array.from(mergedMap.values()));
    }

    return () => {
      copilotkit.removeTool(name, tool.agentId);
      // we are intentionally not removing the render here so that the tools can still render in the chat history
    };
    // Depend on stable keys by default and allow callers to opt into
    // additional dependencies for dynamic tool configuration.
  }, [tool.name, copilotkit, extraDeps.length, ...extraDeps]);
}
