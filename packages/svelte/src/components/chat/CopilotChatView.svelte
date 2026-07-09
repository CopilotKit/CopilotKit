<script lang="ts">
  import type { Message } from "@ag-ui/core";
  import type { Suggestion } from "@copilotkit/core";
  import type { Attachment } from "@copilotkit/shared";
  import type { CopilotChatInputMode, ToolsMenuItem, AutoScrollMode } from "./types";
  import { normalizeAutoScroll } from "./types";
  import CopilotChatMessageView from "./CopilotChatMessageView.svelte";
  import CopilotChatInput from "./CopilotChatInput.svelte";
  import CopilotChatSuggestionView from "./CopilotChatSuggestionView.svelte";

  let {
    messages = [] as Message[],
    isRunning = false,
    welcomeScreen = false,
    suggestions = [] as Suggestion[],
    attachments = [] as Attachment[],
    inputValue = "",
    inputMode = "input" as CopilotChatInputMode,
    inputToolsMenu = [] as (ToolsMenuItem | "-")[],
    isConnecting = false,
    hasExplicitThreadId = false,
    autoScroll = true as AutoScrollMode | boolean,
    onSubmitMessage,
    onStop,
    onInputChange,
    onSelectSuggestion,
    onRemoveAttachment,
    onAddFile,
  }: {
    messages?: Message[];
    isRunning?: boolean;
    welcomeScreen?: boolean;
    suggestions?: Suggestion[];
    attachments?: Attachment[];
    inputValue?: string;
    inputMode?: CopilotChatInputMode;
    inputToolsMenu?: (ToolsMenuItem | "-")[];
    isConnecting?: boolean;
    hasExplicitThreadId?: boolean;
    autoScroll?: AutoScrollMode | boolean;
    onSubmitMessage: (value: string) => void;
    onStop?: () => void;
    onInputChange: (value: string) => void;
    onSelectSuggestion: (suggestion: Suggestion, index: number) => void;
    onRemoveAttachment?: (id: string) => void;
    onAddFile?: () => void;
  } = $props();
</script>

<div class="copilotkit-chat-view">
  {#if welcomeScreen && messages.length === 0}
    <div class="copilotkit-welcome">
      <div class="copilotkit-welcome-content">
        <div class="copilotkit-welcome-icon">🤖</div>
        <h2 class="copilotkit-welcome-title">How can I help you?</h2>
        <p class="copilotkit-welcome-subtitle">Ask me anything to get started.</p>
      </div>
      {#if suggestions.length > 0}
        <CopilotChatSuggestionView
          {suggestions}
          {onSelectSuggestion}
        />
      {/if}
      <CopilotChatInput
        value={inputValue}
        {isRunning}
        {inputMode}
        toolsMenu={inputToolsMenu}
        onSubmit={onSubmitMessage}
        {onStop}
        onInputChange={onInputChange}
        placeholder="Type your message..."
      />
    </div>
  {:else}
    <CopilotChatMessageView {messages} {isRunning} />
    {#if suggestions.length > 0}
      <CopilotChatSuggestionView
        {suggestions}
        {onSelectSuggestion}
      />
    {/if}
    <CopilotChatInput
      value={inputValue}
      {isRunning}
      {inputMode}
      toolsMenu={inputToolsMenu}
      onSubmit={onSubmitMessage}
      {onStop}
      onInputChange={onInputChange}
    />
  {/if}
</div>

<style>
  .copilotkit-chat-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .copilotkit-welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 24px;
    gap: 16px;
  }

  .copilotkit-welcome-content {
    text-align: center;
  }

  .copilotkit-welcome-icon {
    font-size: 48px;
    margin-bottom: 12px;
  }

  .copilotkit-welcome-title {
    font-size: 20px;
    font-weight: 600;
    color: #1f2937;
    margin: 0;
  }

  .copilotkit-welcome-subtitle {
    font-size: 14px;
    color: #6b7280;
    margin: 4px 0 0;
  }
</style>
