<script lang="ts">
  import { useAgent, useSuggestions } from "../../hooks";
  import { DEFAULT_AGENT_ID, randomUUID } from "@copilotkit/shared";
  import type { Suggestion } from "@copilotkit/core";
  import { useCopilotKit } from "../../providers/useCopilotKit";
  import { setChatConfig, ChatConfig } from "./chat-config-context.svelte";
  import CopilotChatView from "./CopilotChatView.svelte";
  import type { CopilotChatProps, CopilotChatInputMode, ToolsMenuItem } from "./types";

  let {
    agentId,
    threadId: explicitThreadId,
    throttleMs,
    autoScroll = true,
    welcomeScreen = true,
    inputValue: controlledInputValue,
    inputMode = "input" as CopilotChatInputMode,
    inputToolsMenu = [] as (ToolsMenuItem | "-")[],
    className = "",
  }: CopilotChatProps = $props();

  let generatedThreadId = $state(randomUUID());
  let resolvedThreadId = $derived(explicitThreadId ?? generatedThreadId);
  let hasExplicitThreadId = $derived(!!explicitThreadId);

  // svelte-ignore state_referenced_locally
  setChatConfig(new ChatConfig(
    agentId ?? DEFAULT_AGENT_ID,
    resolvedThreadId,
    hasExplicitThreadId,
  ));

  // svelte-ignore state_referenced_locally
  let agentHook = useAgent({
    agentId: agentId ?? DEFAULT_AGENT_ID,
    threadId: resolvedThreadId,
    throttleMs,
  });

  // svelte-ignore state_referenced_locally
  let suggestionsHook = useSuggestions({
    agentId: agentId ?? DEFAULT_AGENT_ID,
  });

  let { copilotkit } = useCopilotKit();
  let agent = $derived(agentHook.agent);
  let messages = $derived(agentHook.messages);
  let isRunning = $derived(agentHook.isRunning);
  let suggestions = $derived(suggestionsHook.suggestions);

  function handleSubmitMessage(value: string) {
    if (!agent) return;
    agent.addMessage({ id: randomUUID(), role: "user", content: value } as any);
    copilotkit.runAgent({ agent });
  }

  function handleStop() {
    if (agent) {
      copilotkit.stopAgent({ agent });
    }
  }

  function handleInputChange(_value: string) {
    // parent controlling input
  }

  function handleSelectSuggestion(suggestion: Suggestion, _index: number) {
    if (!agent) return;
    agent.addMessage({ id: randomUUID(), role: "user", content: suggestion.message } as any);
    copilotkit.runAgent({ agent });
  }
</script>

<div class="copilotkit-chat {className}">
  <CopilotChatView
    messages={messages}
    {isRunning}
    {autoScroll}
    {welcomeScreen}
    suggestions={suggestions}
    {inputMode}
    inputToolsMenu={inputToolsMenu}
    onSubmitMessage={handleSubmitMessage}
    onStop={handleStop}
    onInputChange={handleInputChange}
    onSelectSuggestion={handleSelectSuggestion}
  />
</div>

<style>
  .copilotkit-chat {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }
</style>
