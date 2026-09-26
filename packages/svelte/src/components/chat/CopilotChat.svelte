<script lang="ts">
  import { createAgent, createAttachments, createSuggestions } from "../../hooks";
  import {
    DEFAULT_AGENT_ID,
    createAttachmentContent,
    randomUUID,
  } from "@copilotkit/shared";
  import type { AttachmentsConfig, InputContent } from "@copilotkit/shared";
  import type { Suggestion } from "@copilotkit/core";
  import type { UserMessage } from "@ag-ui/core";
  import { useCopilotKit } from "../../providers/useCopilotKit";
  import { setChatConfig, getChatConfig, ChatConfig } from "./chat-config-context.svelte";
  import CopilotChatView from "./CopilotChatView.svelte";
  import type { CopilotChatProps, CopilotChatInputMode, ToolsMenuItem } from "./types";

  function normalizeAttachmentsConfig(
    value: CopilotChatProps["attachments"],
  ): AttachmentsConfig | undefined {
    if (value === undefined || value === false) return undefined;
    if (value === true) return { enabled: true };
    return {
      ...value,
      enabled: value.enabled ?? true,
    };
  }

  let {
    agentId,
    threadId: explicitThreadId,
    throttleMs,
    autoScroll = true,
    welcomeScreen = true,
    inputValue: controlledInputValue,
    onInputChange,
    inputMode = "input" as CopilotChatInputMode,
    inputToolsMenu = [] as (ToolsMenuItem | "-")[],
    attachments: attachmentsProp,
    className = "",
  }: CopilotChatProps = $props();

  let generatedThreadId = $state(randomUUID());
  let resolvedThreadId = $derived(explicitThreadId ?? generatedThreadId);
  let hasExplicitThreadId = $derived(!!explicitThreadId);
  let resolvedAgentId = $derived(agentId ?? DEFAULT_AGENT_ID);
  let attachmentsConfig = $derived(normalizeAttachmentsConfig(attachmentsProp));

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

  // Reactive config via getter so prop updates flow into the hook without
  // re-creating it. Refs bind through Svelte actions (see markup below).
  const attachmentsHandle = createAttachments({
    config: () => attachmentsConfig,
  });
  let selectedAttachments = $derived(attachmentsHandle.attachments);
  let attachmentsEnabled = $derived(attachmentsHandle.enabled);
  let dragOver = $derived(attachmentsHandle.dragOver);

  function handleAddFile() {
    if (!attachmentsEnabled) return;
    // Defer one tick so any open menu closes before the picker opens.
    setTimeout(() => {
      attachmentsHandle.fileInputRef?.click();
    }, 100);
  }

  function handleSubmitMessage(value: string) {
    if (!agent) return;
    if (selectedAttachments.some((a) => a.status === "uploading")) {
      console.error("[CopilotKit] Cannot send while attachments are uploading");
      return;
    }
    const ready = attachmentsHandle.consumeAttachments();
    if (ready.length > 0) {
      const contentParts: InputContent[] = [];
      if (value.trim()) {
        contentParts.push({ type: "text", text: value });
      }
      for (const attachment of ready) {
        contentParts.push(createAttachmentContent(attachment));
      }
      agent.addMessage({
        id: randomUUID(),
        role: "user",
        content: contentParts,
      } as UserMessage);
    } else {
      agent.addMessage({ id: randomUUID(), role: "user", content: value } as UserMessage);
    }
    void copilotkit.runAgent({ agent });
  }

  function handleStop() {
    if (agent) {
      copilotkit.stopAgent({ agent });
    }
  }

  function handleInputChange(value: string) {
    onInputChange?.(value);
  }

  function handleSelectSuggestion(suggestion: Suggestion) {
    if (!agent) return;
    agent.addMessage({ id: randomUUID(), role: "user", content: suggestion.message } as UserMessage);
    void copilotkit.runAgent({ agent });
  }
</script>

<div
  data-copilotkit
  class="copilotkit-chat {className}"
  use:attachmentsHandle.containerAction
>
  {#if attachmentsEnabled}
    <input
      type="file"
      multiple
      use:attachmentsHandle.fileInputAction
      onchange={(e) => void attachmentsHandle.handleFileUpload(e)}
      accept={attachmentsConfig?.accept ?? "*/*"}
      style="display: none"
      data-testid="copilot-file-input"
    />
  {/if}
  <CopilotChatView
    messages={messages}
    {isRunning}
    {autoScroll}
    {welcomeScreen}
    suggestions={suggestions}
    attachments={selectedAttachments}
    {dragOver}
    inputValue={controlledInputValue}
    {inputMode}
    inputToolsMenu={inputToolsMenu}
    onSubmitMessage={handleSubmitMessage}
    onStop={handleStop}
    onInputChange={handleInputChange}
    onSelectSuggestion={handleSelectSuggestion}
    onRemoveAttachment={attachmentsEnabled ? attachmentsHandle.removeAttachment : undefined}
    onAddFile={attachmentsEnabled ? handleAddFile : undefined}
    onDragOver={attachmentsEnabled ? attachmentsHandle.handleDragOver : undefined}
    onDragLeave={attachmentsEnabled ? attachmentsHandle.handleDragLeave : undefined}
    onDrop={attachmentsEnabled ? attachmentsHandle.handleDrop : undefined}
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
