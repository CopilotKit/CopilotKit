import { useCallback, useEffect, useMemo, useRef } from "react";
import { useCopilotKit } from "../context";
import { useCopilotChatConfiguration } from "../providers/CopilotChatConfigurationProvider";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import type {
  DynamicSuggestionsConfig,
  StaticSuggestionsConfig,
  SuggestionsConfig,
  Suggestion,
} from "@copilotkit/core";

type StaticSuggestionInput = Omit<Suggestion, "isLoading"> &
  Partial<Pick<Suggestion, "isLoading">>;

type StaticSuggestionsConfigInput = Omit<
  StaticSuggestionsConfig,
  "suggestions"
> & {
  suggestions: StaticSuggestionInput[];
};

type SuggestionsConfigInput =
  | DynamicSuggestionsConfig
  | StaticSuggestionsConfigInput;

export function useConfigureSuggestions(
  config: SuggestionsConfigInput | null | undefined,
  deps?: ReadonlyArray<unknown>,
): void {
  const { copilotkit } = useCopilotKit();
  const chatConfig = useCopilotChatConfiguration();
  const extraDeps = deps ?? [];

  const resolvedConsumerAgentId = useMemo(
    () => chatConfig?.agentId ?? DEFAULT_AGENT_ID,
    [chatConfig?.agentId],
  );

  const rawConsumerAgentId = useMemo(
    () =>
      config ? (config as SuggestionsConfigInput).consumerAgentId : undefined,
    [config],
  );

  const normalizationCacheRef = useRef<{
    serialized: string | null;
    config: SuggestionsConfig | null;
  }>({
    serialized: null,
    config: null,
  });

  const { normalizedConfig, serializedConfig } = useMemo(() => {
    if (!config) {
      normalizationCacheRef.current = { serialized: null, config: null };
      return { normalizedConfig: null, serializedConfig: null };
    }

    if (config.available === "disabled") {
      normalizationCacheRef.current = { serialized: null, config: null };
      return { normalizedConfig: null, serializedConfig: null };
    }

    let built: SuggestionsConfig;
    if (isDynamicConfig(config)) {
      built = {
        ...config,
      } satisfies DynamicSuggestionsConfig;
    } else {
      const normalizedSuggestions = normalizeStaticSuggestions(
        config.suggestions,
      );
      const baseConfig: StaticSuggestionsConfig = {
        ...config,
        suggestions: normalizedSuggestions,
      };
      built = baseConfig;
    }

    const serialized = JSON.stringify(built);
    const cache = normalizationCacheRef.current;
    if (cache.serialized === serialized && cache.config) {
      return { normalizedConfig: cache.config, serializedConfig: serialized };
    }

    normalizationCacheRef.current = { serialized, config: built };
    return { normalizedConfig: built, serializedConfig: serialized };
  }, [config, resolvedConsumerAgentId, ...extraDeps]);
  const latestConfigRef = useRef<SuggestionsConfig | null>(null);
  latestConfigRef.current = normalizedConfig;
  const previousSerializedConfigRef = useRef<string | null>(null);

  const targetAgentId = useMemo(() => {
    if (!normalizedConfig) {
      return resolvedConsumerAgentId;
    }
    const consumer = (
      normalizedConfig as StaticSuggestionsConfig | DynamicSuggestionsConfig
    ).consumerAgentId;
    if (!consumer || consumer === "*") {
      return resolvedConsumerAgentId;
    }
    return consumer;
  }, [normalizedConfig, resolvedConsumerAgentId]);

  const isGlobalConfig =
    rawConsumerAgentId === undefined || rawConsumerAgentId === "*";

  const isDynamicConfigType = useMemo(
    () => !!normalizedConfig && "instructions" in normalizedConfig,
    [normalizedConfig],
  );

  const requestReload = useCallback(() => {
    if (!normalizedConfig) {
      return;
    }

    if (isGlobalConfig) {
      const seen = new Set<string>();
      const agents = Object.values(copilotkit.agents ?? {});
      for (const entry of agents) {
        const agentId = entry.agentId;
        if (!agentId) {
          continue;
        }
        seen.add(agentId);
        if (!entry.isRunning) {
          copilotkit.reloadSuggestions(agentId);
        }
      }
      // Also reload for the chat's resolved consumer agent. The registry can
      // be empty at this point (e.g. runtime info still loading), in which
      // case the loop above wouldn't have fired for the agent the user is
      // actually chatting with — and the welcome screen would render with
      // no suggestions until they navigate away and back.
      if (targetAgentId && !seen.has(targetAgentId)) {
        copilotkit.reloadSuggestions(targetAgentId);
      }
      return;
    }

    if (!targetAgentId) {
      return;
    }

    copilotkit.reloadSuggestions(targetAgentId);
  }, [copilotkit, isGlobalConfig, normalizedConfig, targetAgentId]);

  useEffect(() => {
    if (!serializedConfig || !latestConfigRef.current) {
      return;
    }

    const id = copilotkit.addSuggestionsConfig(latestConfigRef.current);

    requestReload();

    return () => {
      copilotkit.removeSuggestionsConfig(id);
    };
  }, [copilotkit, serializedConfig, requestReload]);

  useEffect(() => {
    if (!normalizedConfig) {
      previousSerializedConfigRef.current = null;
      return;
    }
    if (
      serializedConfig &&
      previousSerializedConfigRef.current === serializedConfig
    ) {
      return;
    }
    if (serializedConfig) {
      previousSerializedConfigRef.current = serializedConfig;
    }
    requestReload();
  }, [normalizedConfig, requestReload, serializedConfig]);

  useEffect(() => {
    if (!normalizedConfig || extraDeps.length === 0) {
      return;
    }
    requestReload();
  }, [extraDeps.length, normalizedConfig, requestReload, ...extraDeps]);

  // When agents arrive after the initial render (runtime info just landed),
  // re-request a reload so dynamic configs that need a real agent can finally
  // generate.  Skip for static configs — they don't need an agent and the
  // initial mount reload already handled them.  Skip when the target agent
  // is already in the registry — the initial reload already covered it, and
  // re-firing on every subsequent `onAgentsChanged` (e.g. dev-mode hot
  // reloads, sibling chat configs mounting) would stack overlapping
  // generations.
  useEffect(() => {
    if (!normalizedConfig || !isDynamicConfigType) return;
    if (!targetAgentId) return;

    const initiallyPresent = !!copilotkit.getAgent(targetAgentId);
    if (initiallyPresent) return;

    const subscription = copilotkit.subscribe({
      onAgentsChanged: () => {
        if (copilotkit.getAgent(targetAgentId)) {
          requestReload();
          subscription.unsubscribe();
        }
      },
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [
    copilotkit,
    normalizedConfig,
    isDynamicConfigType,
    targetAgentId,
    requestReload,
  ]);
}

function isDynamicConfig(
  config: SuggestionsConfigInput,
): config is DynamicSuggestionsConfig {
  return "instructions" in config;
}

function normalizeStaticSuggestions(
  suggestions: StaticSuggestionInput[],
): Suggestion[] {
  return suggestions.map((suggestion) => ({
    ...suggestion,
    isLoading: suggestion.isLoading ?? false,
  }));
}
