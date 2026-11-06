import { useEffect, useRef } from "react";
import { useCopilotKit, useDefaultAgentId } from "../context";
import { useCopilotChatConfiguration } from "../providers/CopilotChatConfigurationProvider";
import { ɵbindSuggestionsConfig, ɵresolveAgentId } from "@copilotkit/core";
import type {
  ɵSuggestionsBinding,
  ɵSuggestionsConfigInput,
} from "@copilotkit/core";

/**
 * Registers a suggestions configuration (dynamic or static) for the current
 * chat. A global config (no `consumerAgentId`, or `"*"`) applies to every
 * agent and loads for the surrounding chat's agent first.
 *
 * Pass `deps` to reload suggestions when values the config reads change.
 *
 * @example
 * useConfigureSuggestions({
 *   instructions: "Suggest concise next steps for the user",
 *   available: "always",
 * });
 */
export function useConfigureSuggestions(
  config: ɵSuggestionsConfigInput | null | undefined,
  deps?: ReadonlyArray<unknown>,
): void {
  const { copilotkit } = useCopilotKit();
  const chatConfig = useCopilotChatConfiguration();
  const providerAgentId = useDefaultAgentId();
  const chatAgentId = ɵresolveAgentId({
    chatAgentId: chatConfig?.agentId,
    providerAgentId,
  });
  const extraDeps = deps ?? [];

  const bindingRef = useRef<ɵSuggestionsBinding | null>(null);
  const latestRef = useRef({ config, chatAgentId });
  latestRef.current = { config, chatAgentId };

  useEffect(() => {
    const latest = latestRef.current;
    const binding = ɵbindSuggestionsConfig(copilotkit, latest.config, {
      chatAgentId: latest.chatAgentId,
    });
    bindingRef.current = binding;
    return () => {
      binding.dispose();
      if (bindingRef.current === binding) bindingRef.current = null;
    };
  }, [copilotkit]);

  // The binding compares configs by content, so a new inline object on every
  // render is a no-op.
  useEffect(() => {
    bindingRef.current?.update(config, { chatAgentId });
  }, [config, chatAgentId]);

  const depsMountedRef = useRef(false);
  useEffect(() => {
    if (!depsMountedRef.current) {
      depsMountedRef.current = true;
      return;
    }
    if (extraDeps.length > 0) bindingRef.current?.reload();
  }, [extraDeps.length, ...extraDeps]);
}
