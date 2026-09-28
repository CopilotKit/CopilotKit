<script lang="ts">
  import type { CopilotChatInputMode, ToolsMenuItem } from "./types";
  import type { Attachment } from "@copilotkit/shared";
  import CopilotChatAttachmentQueue from "./CopilotChatAttachmentQueue.svelte";

  let {
    value: initialValue = "",
    isRunning = false,
    onSubmit,
    onStop,
    onInputChange,
    placeholder = "Type a message...",
    attachments = [] as Attachment[],
    canAddFile = false,
    onAddFile,
    onRemoveAttachment,
  }: {
    value?: string;
    isRunning?: boolean;
    inputMode?: CopilotChatInputMode;
    toolsMenu?: (ToolsMenuItem | "-")[];
    onSubmit: (value: string) => void;
    onStop?: () => void;
    onInputChange: (value: string) => void;
    placeholder?: string;
    attachments?: Attachment[];
    canAddFile?: boolean;
    onAddFile?: () => void;
    onRemoveAttachment?: (id: string) => void;
  } = $props();

  let localValue = $derived(initialValue);
  let hasUploading = $derived(attachments.some((a) => a.status === "uploading"));
  let canSend = $derived(
    isRunning ? true : hasUploading ? false : localValue.trim().length > 0 || attachments.length > 0,
  );

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function send() {
    // Mirror React/Vue: block sends while uploads are in flight. Attachments
    // alone (no text) are a valid send.
    if (hasUploading || isRunning) return;
    const trimmed = localValue.trim();
    if (!trimmed && attachments.length === 0) return;
    onSubmit(trimmed);
    localValue = "";
    onInputChange("");
  }

  function handleInput() {
    onInputChange(localValue);
  }
</script>

<div class="copilotkit-input">
  {#if attachments.length > 0}
    <CopilotChatAttachmentQueue {attachments} {onRemoveAttachment} />
  {/if}
  {#if hasUploading}
    <div class="copilotkit-upload-hint" role="status">
      Uploading attachments…
    </div>
  {/if}
  <div class="copilotkit-input-row">
    {#if canAddFile}
      <button
        type="button"
        class="copilotkit-attach-btn"
        aria-label="Add file"
        onclick={onAddFile}
      >
        +
      </button>
    {/if}
    <textarea
      class="copilotkit-textarea"
      value={localValue}
      oninput={(e) => { localValue = (e.target as HTMLTextAreaElement).value; handleInput(); }}
      onkeydown={handleKeydown}
      placeholder={placeholder}
      rows="1"
      disabled={isRunning}
    ></textarea>
    <button
      class="copilotkit-send-btn"
      onclick={isRunning && onStop ? onStop : send}
      disabled={!isRunning && !canSend}
    >
      {#if isRunning}
        ■
      {:else}
        ↑
      {/if}
    </button>
  </div>
</div>

<style>
  .copilotkit-input {
    border-top: 1px solid #e5e7eb;
    padding: 12px 16px;
    background: #fff;
  }

  .copilotkit-input-row {
    display: flex;
    gap: 8px;
    align-items: flex-end;
  }

  .copilotkit-textarea {
    flex: 1;
    resize: none;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 14px;
    line-height: 1.5;
    font-family: inherit;
    outline: none;
    min-height: 40px;
    max-height: 200px;
  }

  .copilotkit-textarea:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
  }

  .copilotkit-textarea:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .copilotkit-send-btn {
    width: 40px;
    height: 40px;
    border-radius: 8px;
    border: none;
    background: #3b82f6;
    color: #fff;
    font-size: 18px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .copilotkit-send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .copilotkit-send-btn:hover:not(:disabled) {
    background: #2563eb;
  }

  .copilotkit-attach-btn {
    width: 40px;
    height: 40px;
    border-radius: 8px;
    border: 1px solid #d1d5db;
    background: #f9fafb;
    color: #374151;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .copilotkit-attach-btn:hover {
    background: #f3f4f6;
  }

  .copilotkit-upload-hint {
    font-size: 12px;
    color: #6b7280;
    padding: 0 2px 8px;
  }
</style>
