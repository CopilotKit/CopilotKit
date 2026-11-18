import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ɵresolveAgentId,
  ɵsubscribeToAgentSuggestions,
} from "@copilotkit/core";
import type { Suggestion } from "@copilotkit/core";
import { useCopilotKit, useDefaultAgentId } from "../context";
import { useCopilotChatConfiguration } from "../providers/CopilotChatConfigurationProvider";

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
  const { copilotkit } = useCopilotKit();
  const config = useCopilotChatConfiguration();
  const providerAgentId = useDefaultAgentId();
  const resolvedAgentId = useMemo(
    () =>
      ɵresolveAgentId({
        agentId,
        chatAgentId: config?.agentId,
        providerAgentId,
      }),
    [agentId, config?.agentId, providerAgentId],
  );

  const [result, setResult] = useState(() =>
    copilotkit.getSuggestions(resolvedAgentId),
  );

  useEffect(() => {
    setResult(copilotkit.getSuggestions(resolvedAgentId));
    return ɵsubscribeToAgentSuggestions(copilotkit, resolvedAgentId, setResult);
  }, [copilotkit, resolvedAgentId]);

  const reloadSuggestions = useCallback(() => {
    copilotkit.reloadSuggestions(resolvedAgentId);
    // Loading state is handled by onSuggestionsStartedLoading event
  }, [copilotkit, resolvedAgentId]);

  const clearSuggestions = useCallback(() => {
    copilotkit.clearSuggestions(resolvedAgentId);
    // State updates are handled by onSuggestionsChanged event
  }, [copilotkit, resolvedAgentId]);

  return {
    suggestions: result.suggestions,
    reloadSuggestions,
    clearSuggestions,
    isLoading: result.isLoading,
  };
}
