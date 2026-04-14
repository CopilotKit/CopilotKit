import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAgent, useCopilotChatConfiguration, useCopilotKit } from "../v2";
import { CopilotKitError, parseJson } from "@copilotkit/shared";
import { useCopilotContext } from "../context";
import {
  AbstractAgent,
  AgentSubscriber,
  AGUIConnectNotImplementedError,
} from "@ag-ui/client";
import { useErrorToast } from "./error-boundary/error-utils";
import { CopilotKitCoreSubscriber } from "@copilotkit/core";
import { useToast } from "./toast/toast-provider";
import { CopilotKitLowLevelError } from "@copilotkit/shared";

const usePredictStateSubscription = (agent?: AbstractAgent) => {
  const predictStateToolsRef = useRef<
    {
      tool: string;
      state_key: string;
      tool_argument: string;
    }[]
  >([]);

  const getSubscriber = useCallback(
    (agent: AbstractAgent): AgentSubscriber => ({
      onCustomEvent: ({ event }) => {
        if (event.name === "PredictState") {
          predictStateToolsRef.current = event.value;
        }
      },
      onToolCallArgsEvent: ({ partialToolCallArgs, toolCallName }) => {
        predictStateToolsRef.current.forEach((t) => {
          if (t?.tool !== toolCallName) return;

          const emittedState =
            typeof partialToolCallArgs === "string"
              ? parseJson(
                  partialToolCallArgs as unknown as string,
                  partialToolCallArgs,
                )
              : partialToolCallArgs;

          agent.setState({
            [t.state_key]: emittedState[t.state_key],
          });
        });
      },
    }),
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
  const existingConfig = useCopilotChatConfiguration();
  const resolvedAgentId = existingConfig?.agentId;

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
