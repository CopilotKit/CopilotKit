import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAgent, useCopilotChatConfiguration, useCopilotKit } from "../v2";
import {
  CopilotKitError,
  DEFAULT_AGENT_ID,
  partialJSONParse,
} from "@copilotkit/shared";
import { useCopilotContext } from "../context";
import type { AbstractAgent, AgentSubscriber } from "@ag-ui/client";
import { AGUIConnectNotImplementedError } from "@ag-ui/client";
import { useErrorToast } from "./error-boundary/error-utils";
import type { CopilotKitCoreSubscriber } from "@copilotkit/core";
import { useToast } from "./toast/toast-provider";
import { CopilotKitLowLevelError } from "@copilotkit/shared";

export type PredictStateTool = {
  tool: string;
  state_key: string;
  tool_argument?: string;
};

export function getPredictStateUpdate(
  config: PredictStateTool,
  toolCallName: string,
  partialToolCallArgs: Record<string, unknown> | string,
): Record<string, unknown> | undefined {
  if (config.tool !== toolCallName) return undefined;

  const emittedState =
    typeof partialToolCallArgs === "string"
      ? partialJSONParse(partialToolCallArgs)
      : partialToolCallArgs;

  if (config.tool_argument) {
    if (!(config.tool_argument in emittedState)) return undefined;

    return {
      [config.state_key]: emittedState[config.tool_argument],
    };
  }

  return {
    [config.state_key]: emittedState,
  };
}

export function createPredictStateSubscriber(
  agent: AbstractAgent,
  predictStateToolsRef: { current: PredictStateTool[] },
): AgentSubscriber {
  return {
    onCustomEvent: ({ event }) => {
      if (event.name === "PredictState") {
        predictStateToolsRef.current = event.value;
      }
    },
    onToolCallArgsEvent: ({ partialToolCallArgs, toolCallName }) => {
      predictStateToolsRef.current.forEach((config) => {
        const update = getPredictStateUpdate(
          config,
          toolCallName,
          partialToolCallArgs,
        );
        if (update) agent.setState(update);
      });
    },
  };
}

const usePredictStateSubscription = (agent?: AbstractAgent) => {
  const predictStateToolsRef = useRef<PredictStateTool[]>([]);

  const getSubscriber = useCallback(
    (subscriptionAgent: AbstractAgent): AgentSubscriber =>
      createPredictStateSubscriber(subscriptionAgent, predictStateToolsRef),
    [],
  );

  useEffect(() => {
    if (!agent) return;

    const subscriber = getSubscriber(agent);
    const { unsubscribe } = agent.subscribe(subscriber);
    return () => {
      unsubscribe();
    };
  }, [agent, getSubscriber]);
};

function CopilotListenersAgentSubscription() {
  const { copilotkit } = useCopilotKit();
  const existingConfig = useCopilotChatConfiguration();
  const configAgentId = existingConfig?.agentId;

  // This subscription is provider-level (a sibling of {children}), so the
  // nearest chat configuration is the top-level one seeded with
  // `props.agent ?? "default"`. When the app passes no `agent` prop, that id is
  // "default" — but the runtime may register only a non-default agent. Binding
  // useAgent('default') would then throw "Agent 'default' not found" once the
  // runtime syncs, crashing the whole app even though the actual <CopilotChat>
  // subtree is correctly configured (#5533).
  //
  // The PredictState subscription here is best-effort and must never crash the
  // app. When the resolved id would be the default but no default agent is
  // registered, fall back to the sole/first registered agent so the hook still
  // binds something real. We compute a safe id (never call the hook
  // conditionally — that would violate the rules of hooks).
  const resolvedAgentId = useMemo(() => {
    const requested = configAgentId ?? DEFAULT_AGENT_ID;
    const registered = copilotkit.agents ?? {};
    // Check the registry record directly rather than `copilotkit.getAgent()`:
    // getAgent() logs `console.warn("Agent <id> not found")` on a post-sync
    // miss, which is noisy for a valid setup where the default placeholder
    // simply isn't a registered agent (#5533).
    if (registered[requested]) {
      return requested;
    }
    // Requested agent isn't registered. If it's the default placeholder, bind
    // the first registered agent instead of throwing. (For an explicitly
    // configured non-default id, leave it as-is so useAgent's provisional /
    // error handling applies as before.)
    if (requested === DEFAULT_AGENT_ID) {
      const firstRegistered = Object.keys(registered)[0];
      if (firstRegistered) {
        return firstRegistered;
      }
    }
    return requested;
  }, [configAgentId, copilotkit.agents]);

  const { agent } = useAgent({ agentId: resolvedAgentId });

  usePredictStateSubscription(agent);

  return null;
}

export function CopilotListeners() {
  const { copilotkit } = useCopilotKit();
  const { setBannerError } = useToast();

  // Only render the agent subscription when agents are registered or a runtime
  // is configured. Without this guard, useAgent() throws when the agents map is
  // empty and no runtimeUrl is set (#3249).
  const hasAgents = Object.keys(copilotkit.agents ?? {}).length > 0;
  const hasRuntime = copilotkit.runtimeUrl !== undefined;

  useEffect(() => {
    const subscriber: CopilotKitCoreSubscriber = {
      onError: ({ error, code, context }) => {
        // Silently ignore abort errors (e.g. from navigation during active requests)
        if (
          error.name === "AbortError" ||
          error.message === "Fetch is aborted" ||
          error.message === "signal is aborted without reason" ||
          error.message === "component unmounted" ||
          !error.message
        ) {
          return;
        }

        // Always log full error details in development
        if (process.env.NODE_ENV === "development") {
          console.error(
            "[CopilotKit] Agent error:",
            error.message,
            "\n  Code:",
            code,
            "\n  Context:",
            context,
            "\n  Stack:",
            error.stack,
          );
        }

        const ckError = new CopilotKitLowLevelError({
          error,
          message: error.message,
          url: typeof window !== "undefined" ? window.location.href : "",
        });

        // Attach original error details for the banner to display
        (ckError as any).details = {
          code,
          context,
          stack: error.stack,
          originalMessage: error.message,
        };

        setBannerError(ckError);
      },
    };
    const subscription = copilotkit.subscribe(subscriber);

    return () => {
      subscription.unsubscribe();
    };
  }, [copilotkit?.subscribe]);

  return hasAgents || hasRuntime ? <CopilotListenersAgentSubscription /> : null;
}
