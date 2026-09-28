<script lang="ts">
  import type { Message } from "@ag-ui/core";
  import type { Suggestion } from "@copilotkit/core";
  import type { Attachment } from "@copilotkit/shared";
  import type { CopilotChatInputMode, ToolsMenuItem, AutoScrollMode } from "./types";
  import CopilotChatMessageView from "./CopilotChatMessageView.svelte";
  import CopilotChatInput from "./CopilotChatInput.svelte";
  import CopilotChatSuggestionView from "./CopilotChatSuggestionView.svelte";

  let {
    messages = [] as Message[],
    isRunning = false,
    welcomeScreen = false,
    suggestions = [] as Suggestion[],
    attachments = [] as Attachment[],
    dragOver = false,
    inputValue = "",
    inputMode = "input" as CopilotChatInputMode,
    inputToolsMenu = [] as (ToolsMenuItem | "-")[],
    autoScroll = true as AutoScrollMode | boolean,
    onSubmitMessage,
    onStop,
    onInputChange,
    onSelectSuggestion,
    onRemoveAttachment,
    onAddFile,
    onDragOver,
    onDragLeave,
    onDrop,
  }: {
    messages?: Message[];
    isRunning?: boolean;
    welcomeScreen?: boolean;
    suggestions?: Suggestion[];
    attachments?: Attachment[];
    dragOver?: boolean;
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
    onDragOver?: (event: DragEvent) => void;
    onDragLeave?: (event: DragEvent) => void;
    onDrop?: (event: DragEvent) => void;
  } = $props();

  let canAddFile = $derived(!!onAddFile);
</script>

<div
  class="copilotkit-chat-view"
  class:drag-over={dragOver}
  role="presentation"
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
>
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
    </div>
  {:else}
    <CopilotChatMessageView {messages} {isRunning} {autoScroll} />
    {#if suggestions.length > 0}
      <CopilotChatSuggestionView
        {suggestions}
        {onSelectSuggestion}
      />
    {/if}
  {/if}
  <CopilotChatInput
    value={inputValue}
    {isRunning}
    {inputMode}
    toolsMenu={inputToolsMenu}
    onSubmit={onSubmitMessage}
    {onStop}
    onInputChange={onInputChange}
    {attachments}
    {canAddFile}
    {onAddFile}
    {onRemoveAttachment}
    placeholder={welcomeScreen && messages.length === 0
      ? "Type your message..."
      : "Type a message..."}
  />
  {#if dragOver}
    <div class="copilotkit-drag-overlay" data-testid="copilot-drag-overlay">
      Drop files to attach
    </div>
  {/if}
</div>

<style>
  .copilotkit-chat-view {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    position: relative;
  }

  .copilotkit-chat-view.drag-over {
    outline: 2px dashed #3b82f6;
    outline-offset: -2px;
  }

  .copilotkit-drag-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(59, 130, 246, 0.08);
    color: #1d4ed8;
    font-size: 14px;
    font-weight: 600;
    pointer-events: none;
    z-index: 5;
  }

  .copilotkit-welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    min-height: 0;
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
