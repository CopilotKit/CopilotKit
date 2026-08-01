import { useCallback, useEffect, useMemo, useState } from "react";
import type { Suggestion } from "@copilotkit/core";
import { useCopilotKit } from "../context";
import { useCopilotChatConfiguration } from "../providers/CopilotChatConfigurationProvider";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";

export interface UseSuggestionsOptions {
  agentId?: string;
}

export interface UseSuggestionsResult {
  suggestions: Suggestion[];
  reloadSuggestions: () => void;
  clearSuggestions: () => void;
  isLoading: boolean;
}

export function useSuggestions({
  agentId,
}: UseSuggestionsOptions = {}): UseSuggestionsResult {
  const { copilotkit, waitForHeaders } = useCopilotKit();
  const config = useCopilotChatConfiguration();
  const resolvedAgentId = useMemo(
    () => agentId ?? config?.agentId ?? DEFAULT_AGENT_ID,
    [agentId, config?.agentId],
  );

  const [suggestions, setSuggestions] = useState<Suggestion[]>(() => {
    const result = copilotkit.getSuggestions(resolvedAgentId);
    return result.suggestions;
  });
  const [isLoading, setIsLoading] = useState(() => {
    const result = copilotkit.getSuggestions(resolvedAgentId);
    return result.isLoading;
  });

  useEffect(() => {
    const result = copilotkit.getSuggestions(resolvedAgentId);
    setSuggestions(result.suggestions);
    setIsLoading(result.isLoading);
  }, [copilotkit, resolvedAgentId]);

  useEffect(() => {
    const subscription = copilotkit.subscribe({
      onSuggestionsChanged: ({
        agentId: changedAgentId,
        suggestions: changedSuggestions,
      }) => {
        if (changedAgentId !== resolvedAgentId) {
          return;
        }
        setSuggestions(changedSuggestions);
      },
      onSuggestionsStartedLoading: ({ agentId: changedAgentId }) => {
        if (changedAgentId !== resolvedAgentId) {
          return;
        }
        setIsLoading(true);
      },
      onSuggestionsFinishedLoading: ({ agentId: changedAgentId }) => {
        if (changedAgentId !== resolvedAgentId) {
          return;
        }
        setIsLoading(false);
      },
      onSuggestionsConfigChanged: () => {
        const result = copilotkit.getSuggestions(resolvedAgentId);
        setSuggestions(result.suggestions);
        setIsLoading(result.isLoading);
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [copilotkit, resolvedAgentId]);

  const reloadSuggestions = useCallback(() => {
    const reload = () => copilotkit.reloadSuggestions(resolvedAgentId);
    try {
      const pendingHeaders = waitForHeaders?.();
      if (pendingHeaders) {
        void pendingHeaders.then(reload, () => {});
        return;
      }
    } catch {
      return;
    }
    reload();
    // Loading state is handled by onSuggestionsStartedLoading event
  }, [copilotkit, resolvedAgentId, waitForHeaders]);

  const clearSuggestions = useCallback(() => {
    copilotkit.clearSuggestions(resolvedAgentId);
    // State updates are handled by onSuggestionsChanged event
  }, [copilotkit, resolvedAgentId]);

  return {
    suggestions,
    reloadSuggestions,
    clearSuggestions,
    isLoading,
  };
}
