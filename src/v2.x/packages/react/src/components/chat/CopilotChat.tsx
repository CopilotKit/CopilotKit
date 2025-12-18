import { useAgent } from "@/hooks/use-agent";
import { useSuggestions } from "@/hooks/use-suggestions";
import { CopilotChatView, CopilotChatViewProps } from "./CopilotChatView";
import CopilotChatInput, { CopilotChatInputProps } from "./CopilotChatInput";
import {
  CopilotChatConfigurationProvider,
  CopilotChatLabels,
  useCopilotChatConfiguration,
} from "@/providers/CopilotChatConfigurationProvider";
import { DEFAULT_AGENT_ID, randomUUID } from "@copilotkitnext/shared";
import { Suggestion } from "@copilotkitnext/core";
import { useCallback, useEffect, useMemo } from "react";
import { merge } from "ts-deepmerge";
import { useCopilotKit } from "@/providers/CopilotKitProvider";
import { AbstractAgent, AGUIConnectNotImplementedError } from "@ag-ui/client";
import { renderSlot, SlotValue } from "@/lib/slots";

export type CopilotChatProps = Omit<
  CopilotChatViewProps,
  "messages" | "isRunning" | "suggestions" | "suggestionLoadingIndexes" | "onSelectSuggestion"
> & {
  agentId?: string;
  threadId?: string;
  labels?: Partial<CopilotChatLabels>;
  chatView?: SlotValue<typeof CopilotChatView>;
  isModalDefaultOpen?: boolean;
};
export function CopilotChat({ agentId, threadId, labels, chatView, isModalDefaultOpen, ...props }: CopilotChatProps) {
  // Check for existing configuration provider
  const existingConfig = useCopilotChatConfiguration();

  // Apply priority: props > existing config > defaults
  const resolvedAgentId = agentId ?? existingConfig?.agentId ?? DEFAULT_AGENT_ID;
  const resolvedThreadId = useMemo(
    () => threadId ?? existingConfig?.threadId ?? randomUUID(),
    [threadId, existingConfig?.threadId],
  );
  const { agent } = useAgent({ agentId: resolvedAgentId });
  const { copilotkit } = useCopilotKit();

  const { suggestions: autoSuggestions } = useSuggestions({ agentId: resolvedAgentId });

  const {
    inputProps: providedInputProps,
    messageView: providedMessageView,
    suggestionView: providedSuggestionView,
    ...restProps
  } = props;

  useEffect(() => {
    const connect = async (agent: AbstractAgent) => {
      try {
        await copilotkit.connectAgent({ agent });
      } catch (error) {
        if (error instanceof AGUIConnectNotImplementedError) {
          // connect not implemented, ignore
        } else {
          throw error;
        }
      }
    };
    agent.threadId = resolvedThreadId;
    connect(agent);
    return () => {};
  }, [resolvedThreadId, agent, copilotkit, resolvedAgentId]);

  const onSubmitInput = useCallback(
    async (value: string) => {
      agent.addMessage({
        id: randomUUID(),
        role: "user",
        content: value,
      });
      try {
        await copilotkit.runAgent({ agent });
      } catch (error) {
        console.error("CopilotChat: runAgent failed", error);
      }
    },
    [agent, copilotkit],
  );

  const handleSelectSuggestion = useCallback(
    async (suggestion: Suggestion) => {
      agent.addMessage({
        id: randomUUID(),
        role: "user",
        content: suggestion.message,
      });

      try {
        await copilotkit.runAgent({ agent });
      } catch (error) {
        console.error("CopilotChat: runAgent failed after selecting suggestion", error);
      }
    },
    [agent, copilotkit],
  );

  const stopCurrentRun = useCallback(() => {
    try {
      copilotkit.stopAgent({ agent });
    } catch (error) {
      console.error("CopilotChat: stopAgent failed", error);
      try {
        agent.abortRun();
      } catch (abortError) {
        console.error("CopilotChat: abortRun fallback failed", abortError);
      }
    }
  }, [agent, copilotkit]);

  const mergedProps = merge(
    {
      isRunning: agent.isRunning,
      suggestions: autoSuggestions,
      onSelectSuggestion: handleSelectSuggestion,
      suggestionView: providedSuggestionView,
    },
    {
      ...restProps,
      ...(typeof providedMessageView === "string"
        ? { messageView: { className: providedMessageView } }
        : providedMessageView !== undefined
          ? { messageView: providedMessageView }
          : {}),
    },
  );

  const providedStopHandler = providedInputProps?.onStop;
  const hasMessages = agent.messages.length > 0;
  const shouldAllowStop = agent.isRunning && hasMessages;
  const effectiveStopHandler = shouldAllowStop ? (providedStopHandler ?? stopCurrentRun) : providedStopHandler;

  const finalInputProps = {
    ...providedInputProps,
    onSubmitMessage: onSubmitInput,
    onStop: effectiveStopHandler,
    isRunning: agent.isRunning,
  } as Partial<CopilotChatInputProps> & { onSubmitMessage: (value: string) => void };

  finalInputProps.mode = agent.isRunning ? "processing" : (finalInputProps.mode ?? "input");

  const finalProps = merge(mergedProps, {
    messages: agent.messages,
    inputProps: finalInputProps,
  }) as CopilotChatViewProps;

  // Always create a provider with merged values
  // This ensures priority: props > existing config > defaults
  const RenderedChatView = renderSlot(chatView, CopilotChatView, finalProps);

  return (
    <CopilotChatConfigurationProvider
      agentId={resolvedAgentId}
      threadId={resolvedThreadId}
      labels={labels}
      isModalDefaultOpen={isModalDefaultOpen}
    >
      {RenderedChatView}
    </CopilotChatConfigurationProvider>
  );
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CopilotChat {
  export const View = CopilotChatView;
}
