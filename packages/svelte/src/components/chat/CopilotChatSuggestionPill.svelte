<script lang="ts">
  import type { Suggestion } from "@copilotkit/core";

  let {
    suggestion,
    index,
    isLoading = false,
    onSelect,
  }: {
    suggestion: Suggestion;
    index: number;
    isLoading?: boolean;
    onSelect: () => void;
  } = $props();
</script>

<button
  class="copilotkit-suggestion-pill"
  onclick={onSelect}
  disabled={isLoading}
>
  {#if isLoading}
    <span class="copilotkit-spinner"></span>
  {/if}
  {suggestion.message}
</button>

<style>
  .copilotkit-suggestion-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border: 1px solid #d1d5db;
    border-radius: 16px;
    background: #fff;
    font-size: 13px;
    color: #374151;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
  }

  .copilotkit-suggestion-pill:hover:not(:disabled) {
    border-color: #3b82f6;
    color: #3b82f6;
    background: #eff6ff;
  }

  .copilotkit-suggestion-pill:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .copilotkit-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid #e5e7eb;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
