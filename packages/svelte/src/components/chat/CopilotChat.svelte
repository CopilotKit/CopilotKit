<script lang="ts">
  import { createAgent, createSuggestions } from "../../hooks";
  import { DEFAULT_AGENT_ID, randomUUID } from "@copilotkit/shared";
  import type { Suggestion } from "@copilotkit/core";
  import { useCopilotKit } from "../../providers/useCopilotKit";
  import { setChatConfig, getChatConfig, ChatConfig } from "./chat-config-context.svelte";
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
  let resolvedAgentId = $derived(agentId ?? DEFAULT_AGENT_ID);

  // svelte-ignore state_referenced_locally
  setChatConfig(new ChatConfig(
    agentId ?? DEFAULT_AGENT_ID,
    resolvedThreadId,
    hasExplicitThreadId,
  ));

  let agentHandle = $state<ReturnType<typeof createAgent> | null>(null);
  let suggestionsHandle = $state<ReturnType<typeof createSuggestions> | null>(null);

  // Runs during init (before first render) and when agentId/threadId change.
  // createAgent/createSuggestions inherently have subscribing side-effects
  // (AG-UI event listeners), so $effect.pre is the correct rune — $derived
  // requires pure expressions.
  $effect.pre(() => {
    const id = resolvedAgentId;
    const tid = resolvedThreadId;
    const config = getChatConfig();
    if (config) {
      config.agentId = id;
      config.threadId = tid;
    }
    agentHandle = createAgent({ agentId: id, threadId: tid, throttleMs });
    suggestionsHandle = createSuggestions({ agentId: id });
  });

  let { copilotkit } = useCopilotKit();
  let agent = $derived(agentHandle?.agent ?? null);
  let messages = $derived(agentHandle?.messages ?? []);
  let isRunning = $derived(agentHandle?.isRunning ?? false);
  let suggestions = $derived(suggestionsHandle?.suggestions ?? []);

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

<div data-copilotkit class="copilotkit-chat {className}">
  <CopilotChatView
    messages={messages}
    {isRunning}
    {autoScroll}
    {welcomeScreen}
    suggestions={suggestions}
    inputValue={controlledInputValue}
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
