<script lang="ts">
  import type { CopilotChatInputMode, ToolsMenuItem } from "./types";

  let {
    value: initialValue = "",
    isRunning = false,
    inputMode = "input" as CopilotChatInputMode,
    toolsMenu = [] as (ToolsMenuItem | "-")[],
    onSubmit,
    onStop,
    onInputChange,
    placeholder = "Type a message...",
  }: {
    value?: string;
    isRunning?: boolean;
    inputMode?: CopilotChatInputMode;
    toolsMenu?: (ToolsMenuItem | "-")[];
    onSubmit: (value: string) => void;
    onStop?: () => void;
    onInputChange: (value: string) => void;
    placeholder?: string;
  } = $props();

  // svelte-ignore state_referenced_locally
  let localValue = $state(initialValue);
  let isFocused = $state(false);

  $effect(() => {
    localValue = initialValue;
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function send() {
    const trimmed = localValue.trim();
    if (!trimmed || isRunning) return;
    onSubmit(trimmed);
  }

  function handleInput() {
    onInputChange(localValue);
  }
</script>

<div class="copilotkit-input">
  <div class="copilotkit-input-row">
    <textarea
      class="copilotkit-textarea"
      value={localValue}
      oninput={(e) => { localValue = (e.target as HTMLTextAreaElement).value; handleInput(); }}
      onkeydown={handleKeydown}
      onfocus={() => isFocused = true}
      onblur={() => isFocused = false}
      placeholder={placeholder}
      rows="1"
      disabled={isRunning}
    ></textarea>
    <button
      class="copilotkit-send-btn"
      onclick={isRunning && onStop ? onStop : send}
      disabled={!isRunning && !localValue.trim()}
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
</style>
