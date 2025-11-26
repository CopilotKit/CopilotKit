import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAgent, useCopilotChatConfiguration, useCopilotKit } from "@copilotkitnext/react";
import { CopilotKitError, parseJson } from "@copilotkit/shared";
import { useCopilotContext } from "../context";
import { AbstractAgent, AgentSubscriber, AGUIConnectNotImplementedError } from "@ag-ui/client";
import { useErrorToast } from "./error-boundary/error-utils";
import { CopilotKitCoreSubscriber } from "@copilotkitnext/core";
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
              ? parseJson(partialToolCallArgs as unknown as string, partialToolCallArgs)
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

export function CopilotListeners() {
  const { copilotkit } = useCopilotKit();
  const existingConfig = useCopilotChatConfiguration();
  const resolvedAgentId = existingConfig?.agentId;
  const { setBannerError } = useToast();

  const { agent } = useAgent({ agentId: resolvedAgentId });

  usePredictStateSubscription(agent);

  useEffect(() => {
    const subscriber: CopilotKitCoreSubscriber = {
      onError: ({ error }) => {
        // @ts-expect-error -- for now, choose a random CPK error type to display the error toast
        setBannerError(new CopilotKitLowLevelError({ error, message: error.message }));
      },
    };
    const subscription = copilotkit.subscribe(subscriber);

    return () => {
      subscription.unsubscribe();
    };
  }, [copilotkit?.subscribe]);

  return null;
}
