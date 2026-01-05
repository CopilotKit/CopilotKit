"use client";

import React, { createContext, useContext, ReactNode, useMemo, useEffect, useReducer, useRef, useState } from "react";
import { ReactActivityMessageRenderer, ReactToolCallRenderer } from "../types";
import { ReactCustomMessageRenderer } from "../types/react-custom-message-renderer";
import { ReactFrontendTool } from "../types/frontend-tool";
import { ReactHumanInTheLoop } from "../types/human-in-the-loop";
import { z } from "zod";
import { FrontendTool } from "@copilotkitnext/core";
import { AbstractAgent } from "@ag-ui/client";
import { CopilotKitCoreReact } from "../lib/react-core";
import { CopilotKitInspector } from "../components/CopilotKitInspector";
import {
  MCPAppsActivityRenderer,
  MCPAppsActivityContentSchema,
  MCPAppsActivityType,
} from "../components/MCPAppsActivityRenderer";

const HEADER_NAME = "X-CopilotCloud-Public-Api-Key";
const COPILOT_CLOUD_CHAT_URL = "https://api.cloud.copilotkit.ai/copilotkit/v1";

// Define the context value interface - idiomatic React naming
export interface CopilotKitContextValue {
  copilotkit: CopilotKitCoreReact;
  /**
   * Set of tool call IDs currently being executed.
   * This is tracked at the provider level to ensure tool execution events
   * are captured even before child components mount.
   */
  executingToolCallIds: ReadonlySet<string>;
}

// Empty set for default context value
const EMPTY_SET: ReadonlySet<string> = new Set();

// Create the CopilotKit context
const CopilotKitContext = createContext<CopilotKitContextValue>({
  copilotkit: null!,
  executingToolCallIds: EMPTY_SET,
});

// Provider props interface
export interface CopilotKitProviderProps {
  children: ReactNode;
  runtimeUrl?: string;
  headers?: Record<string, string>;
  /**
   * The Copilot Cloud public API key.
   */
  publicApiKey?: string;
  /**
   * Alias for `publicApiKey`
   **/
  publicLicenseKey?: string;
  properties?: Record<string, unknown>;
  useSingleEndpoint?: boolean;
  agents__unsafe_dev_only?: Record<string, AbstractAgent>;
  renderToolCalls?: ReactToolCallRenderer<any>[];
  renderActivityMessages?: ReactActivityMessageRenderer<any>[];
  renderCustomMessages?: ReactCustomMessageRenderer[];
  frontendTools?: ReactFrontendTool[];
  humanInTheLoop?: ReactHumanInTheLoop[];
  showDevConsole?: boolean | "auto";
}

// Small helper to normalize array props to a stable reference and warn
function useStableArrayProp<T>(
  prop: T[] | undefined,
  warningMessage?: string,
  isMeaningfulChange?: (initial: T[], next: T[]) => boolean,
): T[] {
  const empty = useMemo<T[]>(() => [], []);
  const value = prop ?? empty;
  const initial = useRef(value);

  useEffect(() => {
    if (
      warningMessage &&
      value !== initial.current &&
      (isMeaningfulChange ? isMeaningfulChange(initial.current, value) : true)
    ) {
      console.error(warningMessage);
    }
  }, [value, warningMessage]);

  return value;
}

// Provider component
export const CopilotKitProvider: React.FC<CopilotKitProviderProps> = ({
  children,
  runtimeUrl,
  headers = {},
  publicApiKey,
  publicLicenseKey,
  properties = {},
  agents__unsafe_dev_only: agents = {},
  renderToolCalls,
  renderActivityMessages,
  renderCustomMessages,
  frontendTools,
  humanInTheLoop,
  showDevConsole = false,
  useSingleEndpoint = false,
}) => {
  const [shouldRenderInspector, setShouldRenderInspector] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (showDevConsole === true) {
      // Explicitly show the inspector
      setShouldRenderInspector(true);
    } else if (showDevConsole === "auto") {
      // Show on localhost or 127.0.0.1 only
      const localhostHosts = new Set(["localhost", "127.0.0.1"]);
      if (localhostHosts.has(window.location.hostname)) {
        setShouldRenderInspector(true);
      } else {
        setShouldRenderInspector(false);
      }
    } else {
      // showDevConsole is false or undefined (default false)
      setShouldRenderInspector(false);
    }
  }, [showDevConsole]);

  // Normalize array props to stable references with clear dev warnings
  const renderToolCallsList = useStableArrayProp<ReactToolCallRenderer<any>>(
    renderToolCalls,
    "renderToolCalls must be a stable array. If you want to dynamically add or remove tools, use `useFrontendTool` instead.",
    (initial, next) => {
      // Only warn if the shape (names+agentId) changed. Allow identity changes
      // to support updated closures from parents (e.g., Storybook state).
      const key = (rc?: ReactToolCallRenderer<unknown>) => `${rc?.agentId ?? ""}:${rc?.name ?? ""}`;
      const setFrom = (arr: ReactToolCallRenderer<unknown>[]) => new Set(arr.map(key));
      const a = setFrom(initial);
      const b = setFrom(next);
      if (a.size !== b.size) return true;
      for (const k of a) if (!b.has(k)) return true;
      return false;
    },
  );

  const renderCustomMessagesList = useStableArrayProp<ReactCustomMessageRenderer>(
    renderCustomMessages,
    "renderCustomMessages must be a stable array.",
  );

  const renderActivityMessagesList = useStableArrayProp<ReactActivityMessageRenderer<any>>(
    renderActivityMessages,
    "renderActivityMessages must be a stable array.",
  );

  // Built-in activity renderers that are always included
  const builtInActivityRenderers = useMemo<ReactActivityMessageRenderer<any>[]>(() => [
    {
      activityType: MCPAppsActivityType,
      content: MCPAppsActivityContentSchema,
      render: MCPAppsActivityRenderer,
    },
  ], []);

  // Combine user-provided activity renderers with built-in ones
  // User-provided renderers take precedence (come first) so they can override built-ins
  const allActivityRenderers = useMemo(() => {
    return [...renderActivityMessagesList, ...builtInActivityRenderers];
  }, [renderActivityMessagesList, builtInActivityRenderers]);

  const resolvedPublicKey = publicApiKey ?? publicLicenseKey;
  const hasLocalAgents = agents && Object.keys(agents).length > 0;

  // Merge a provided publicApiKey into headers (without overwriting an explicit header).
  const mergedHeaders = useMemo(() => {
    if (!resolvedPublicKey) return headers;
    if (headers[HEADER_NAME]) return headers;
    return {
      ...headers,
      [HEADER_NAME]: resolvedPublicKey,
    };
  }, [headers, resolvedPublicKey]);

  if (!runtimeUrl && !resolvedPublicKey && !hasLocalAgents) {
    const message = "Missing required prop: 'runtimeUrl' or 'publicApiKey' or 'publicLicenseKey'";
    if (process.env.NODE_ENV === "production") {
      throw new Error(message);
    } else {
      // In dev/test we warn but allow to facilitate local agents and unit tests.
      console.warn(message);
    }
  }

  const chatApiEndpoint = runtimeUrl ?? (resolvedPublicKey ? COPILOT_CLOUD_CHAT_URL : undefined);

  const frontendToolsList = useStableArrayProp<ReactFrontendTool>(
    frontendTools,
    "frontendTools must be a stable array. If you want to dynamically add or remove tools, use `useFrontendTool` instead.",
  );
  const humanInTheLoopList = useStableArrayProp<ReactHumanInTheLoop>(
    humanInTheLoop,
    "humanInTheLoop must be a stable array. If you want to dynamically add or remove human-in-the-loop tools, use `useHumanInTheLoop` instead.",
  );

  // Note: warnings for array identity changes are handled by useStableArrayProp

  // Process humanInTheLoop tools to create handlers and add render components
  const processedHumanInTheLoopTools = useMemo(() => {
    const processedTools: FrontendTool[] = [];
    const processedRenderToolCalls: ReactToolCallRenderer<unknown>[] = [];

    humanInTheLoopList.forEach((tool) => {
      // Create a promise-based handler for each human-in-the-loop tool
      const frontendTool: FrontendTool = {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        followUp: tool.followUp,
        ...(tool.agentId && { agentId: tool.agentId }),
        handler: async () => {
          // This handler will be replaced by the hook when it runs
          // For provider-level tools, we create a basic handler that waits for user interaction
          return new Promise((resolve) => {
            // The actual implementation will be handled by the render component
            // This is a placeholder that the hook will override
            console.warn(`Human-in-the-loop tool '${tool.name}' called but no interactive handler is set up.`);
            resolve(undefined);
          });
        },
      };
      processedTools.push(frontendTool);

      // Add the render component to renderToolCalls
      if (tool.render) {
        processedRenderToolCalls.push({
          name: tool.name,
          args: tool.parameters!,
          render: tool.render,
          ...(tool.agentId && { agentId: tool.agentId }),
        } as ReactToolCallRenderer<unknown>);
      }
    });

    return { tools: processedTools, renderToolCalls: processedRenderToolCalls };
  }, [humanInTheLoopList]);

  // Combine all tools for CopilotKitCore
  const allTools = useMemo(() => {
    const tools: FrontendTool[] = [];

    // Add frontend tools
    tools.push(...frontendToolsList);

    // Add processed human-in-the-loop tools
    tools.push(...processedHumanInTheLoopTools.tools);

    return tools;
  }, [frontendToolsList, processedHumanInTheLoopTools]);

  // Combine all render tool calls
  const allRenderToolCalls = useMemo(() => {
    const combined: ReactToolCallRenderer<unknown>[] = [...renderToolCallsList];

    // Add render components from frontend tools
    frontendToolsList.forEach((tool) => {
      if (tool.render) {
        // For wildcard tools without parameters, default to z.any()
        const args = tool.parameters || (tool.name === "*" ? z.any() : undefined);
        if (args) {
          combined.push({
            name: tool.name,
            args: args,
            render: tool.render,
          } as ReactToolCallRenderer<unknown>);
        }
      }
    });

    // Add render components from human-in-the-loop tools
    combined.push(...processedHumanInTheLoopTools.renderToolCalls);

    return combined;
  }, [renderToolCallsList, frontendToolsList, processedHumanInTheLoopTools]);

  const copilotkit = useMemo(() => {
    const copilotkit = new CopilotKitCoreReact({
      runtimeUrl: chatApiEndpoint,
      runtimeTransport: useSingleEndpoint ? "single" : "rest",
      headers: mergedHeaders,
      properties,
      agents__unsafe_dev_only: agents,
      tools: allTools,
      renderToolCalls: allRenderToolCalls,
      renderActivityMessages: allActivityRenderers,
      renderCustomMessages: renderCustomMessagesList,
    });

    return copilotkit;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTools, allRenderToolCalls, allActivityRenderers, renderCustomMessagesList, useSingleEndpoint]);

  // Subscribe to render tool calls changes to force re-renders
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  useEffect(() => {
    const subscription = copilotkit.subscribe({
      onRenderToolCallsChanged: () => {
        forceUpdate();
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [copilotkit]);

  // Track executing tool call IDs at the provider level.
  // This is critical for HITL reconnection: when connecting to a thread with
  // pending tool calls, the onToolExecutionStart event fires before child components
  // (like CopilotChatToolCallsView) mount. By tracking at the provider level,
  // we ensure the executing state is captured and available when children mount.
  const [executingToolCallIds, setExecutingToolCallIds] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    const subscription = copilotkit.subscribe({
      onToolExecutionStart: ({ toolCallId }) => {
        setExecutingToolCallIds((prev) => {
          if (prev.has(toolCallId)) return prev;
          const next = new Set(prev);
          next.add(toolCallId);
          return next;
        });
      },
      onToolExecutionEnd: ({ toolCallId }) => {
        setExecutingToolCallIds((prev) => {
          if (!prev.has(toolCallId)) return prev;
          const next = new Set(prev);
          next.delete(toolCallId);
          return next;
        });
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [copilotkit]);

  useEffect(() => {
    copilotkit.setRuntimeUrl(chatApiEndpoint);
    copilotkit.setRuntimeTransport(useSingleEndpoint ? "single" : "rest");
    copilotkit.setHeaders(mergedHeaders);
    copilotkit.setProperties(properties);
    copilotkit.setAgents__unsafe_dev_only(agents);
  }, [chatApiEndpoint, mergedHeaders, properties, agents, useSingleEndpoint]);

  return (
    <CopilotKitContext.Provider
      value={{
        copilotkit,
        executingToolCallIds,
      }}
    >
      {children}
      {shouldRenderInspector ? <CopilotKitInspector core={copilotkit} /> : null}
    </CopilotKitContext.Provider>
  );
};

// Hook to use the CopilotKit instance - returns the full context value
export const useCopilotKit = (): CopilotKitContextValue => {
  const context = useContext(CopilotKitContext);
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  if (!context) {
    throw new Error("useCopilotKit must be used within CopilotKitProvider");
  }
  useEffect(() => {
    const subscription = context.copilotkit.subscribe({
      onRuntimeConnectionStatusChanged: () => {
        forceUpdate();
      },
    });
    return () => {
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return context;
};
