import { useEffect, useMemo, useRef } from "react";
import type { AbstractAgent, Message } from "@ag-ui/client";
import {
  DEFAULT_AGENT_ID,
  GENERATIVE_UI_ACTION_KEY,
  GENERATIVE_UI_ACTIVITY_TYPE,
  GENERATIVE_UI_MANIFEST_KEY,
} from "@copilotkit/shared";
import type { GenerativeUISurfaceContent } from "@copilotkit/shared";
import type { CopilotKitCoreReact } from "../lib/react-core";
import type { GenerativeUICatalog } from "./catalog";
import { createGenerativeUIDispatcher } from "./dispatcher";
import type { GenerativeUIFunctionDefinition } from "./dispatcher";
import { GenerativeUIError } from "./errors";
import type { GenerativeUIErrorInfo } from "./errors";
import { buildGenerativeUIManifest } from "./manifest";
import type {
  GenerativeUIErrorBoundaryConfig,
  GenerativeUIRuntime,
} from "./runtime-context";
import { GenerativeUISurfaceManager } from "./surface-manager";

export interface GenerativeUIConfig {
  catalog: GenerativeUICatalog;
  /** App functions generated UI may call. Not exposed to the agent as tools. */
  functions?: Record<string, GenerativeUIFunctionDefinition>;
  errorBoundary?: GenerativeUIErrorBoundaryConfig;
}

const isDevelopment = () => process.env.NODE_ENV !== "production";

function ingestMessages(
  runtime: GenerativeUIRuntime,
  agent: AbstractAgent,
  messages: ReadonlyArray<Readonly<Message>>,
) {
  if (!agent.threadId) return;
  for (const message of messages) {
    if (
      message.role === "activity" &&
      message.activityType === GENERATIVE_UI_ACTIVITY_TYPE
    ) {
      runtime.manager.ingest(
        agent.threadId,
        agent.agentId,
        message.content as unknown as GenerativeUISurfaceContent,
      );
    }
  }
}

/** Provider-side wiring: manager, dispatcher, agent subscriptions, manifest forwarding. */
export function useGenerativeUIRoot(
  copilotkit: CopilotKitCoreReact,
  config: GenerativeUIConfig | undefined,
): GenerativeUIRuntime | null {
  const configRef = useRef(config);
  configRef.current = config;
  const catalog = config?.catalog;

  const runtime = useMemo<GenerativeUIRuntime | null>(() => {
    if (!catalog) return null;
    // Never throws: it is called from rendering, ingestion and event handlers,
    // and a throwing host `onError` must not break any of them.
    const reportError = (info: GenerativeUIErrorInfo) => {
      try {
        configRef.current?.errorBoundary?.onError?.(info);
      } catch (hostError) {
        if (isDevelopment()) {
          console.error(
            "[generativeUI] errorBoundary.onError threw:",
            hostError,
          );
        }
      }
      if (isDevelopment()) {
        console.warn(
          `[generativeUI] ${info.kind} error in ${info.surfaceId}${info.componentId ? `/${info.componentId}` : ""}: ${info.error?.message}`,
        );
      }
    };
    const manager = new GenerativeUISurfaceManager(catalog, {
      onOperationRejected: ({ surfaceId, index, reason }) =>
        reportError({
          kind: "operation",
          surfaceId,
          error: new Error(`operation ${index} rejected: ${reason}`),
        }),
    });
    const dispatcher = createGenerativeUIDispatcher({
      getProviderFunctions: () => configRef.current?.functions,
      getTool: (name) => copilotkit.getTool({ toolName: name }),
      listTools: () => copilotkit.tools,
      isToolEnabled: (name) => copilotkit.isToolEnabled(name),
      onError: ({ origin, error }) =>
        reportError({ kind: "function", ...origin, error }),
    });
    const forwardEvent: GenerativeUIRuntime["forwardEvent"] = async (
      event,
      agentId,
    ) => {
      const agent = copilotkit.getAgent(agentId ?? DEFAULT_AGENT_ID);
      if (!agent) {
        const error = new GenerativeUIError(
          "event_forward_failed",
          `No agent "${agentId}" to receive "${event.name}"`,
        );
        reportError({
          kind: "event",
          surfaceId: event.surfaceId,
          componentId: event.componentId,
          error,
        });
        return { ok: false, error };
      }
      try {
        // Per-run forwardedProps, not provider properties: tool-call follow-up
        // runs must not carry (and replay) the same user event.
        await copilotkit.runAgent({
          agent,
          forwardedProps: { [GENERATIVE_UI_ACTION_KEY]: event },
        });
        return { ok: true, result: undefined };
      } catch (cause) {
        const error = new GenerativeUIError(
          "event_forward_failed",
          `Forwarding "${event.name}" failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
        reportError({
          kind: "event",
          surfaceId: event.surfaceId,
          componentId: event.componentId,
          error,
        });
        return { ok: false, error };
      }
    };
    return {
      manager,
      dispatcher,
      catalog,
      forwardEvent,
      reportError,
      get errorFallback() {
        return configRef.current?.errorBoundary?.fallback;
      },
    };
  }, [catalog, copilotkit]);

  useEffect(() => {
    if (!runtime) return;
    const watched = new WeakSet<AbstractAgent>();
    const agentSubscriptions: Array<{ unsubscribe(): void }> = [];
    const subscription = copilotkit.subscribe({
      // Awaited by core before it reads properties for the run, so the manifest
      // set here travels with this very run.
      onAgentRunStarted: ({ agent }) => {
        runtime.manager.setActiveThread(agent.threadId);
        copilotkit.setProperties({
          ...copilotkit.properties,
          [GENERATIVE_UI_MANIFEST_KEY]: buildGenerativeUIManifest(
            runtime,
            agent.threadId,
          ),
        });
        if (!watched.has(agent)) {
          watched.add(agent);
          agentSubscriptions.push(
            agent.subscribe({
              onMessagesChanged: ({ messages }) =>
                ingestMessages(runtime, agent, messages),
            }),
          );
        }
        ingestMessages(runtime, agent, agent.messages);
      },
    });
    return () => {
      subscription.unsubscribe();
      for (const s of agentSubscriptions) s.unsubscribe();
      // Stop advertising a catalog that is no longer mounted.
      if (GENERATIVE_UI_MANIFEST_KEY in copilotkit.properties) {
        const { [GENERATIVE_UI_MANIFEST_KEY]: _manifest, ...rest } =
          copilotkit.properties;
        copilotkit.setProperties(rest);
      }
    };
  }, [runtime, copilotkit]);

  return runtime;
}
