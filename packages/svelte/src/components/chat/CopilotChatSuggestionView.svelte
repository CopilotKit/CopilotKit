<script lang="ts">
  import type { Suggestion } from "@copilotkit/core";
  import CopilotChatSuggestionPill from "./CopilotChatSuggestionPill.svelte";

  let {
    suggestions = [] as Suggestion[],
    loadingIndexes = [] as readonly number[],
    onSelectSuggestion,
  }: {
    suggestions?: Suggestion[];
    loadingIndexes?: readonly number[];
    onSelectSuggestion: (suggestion: Suggestion, index: number) => void;
  } = $props();
</script>

{#if suggestions.length > 0}
  <div class="copilotkit-suggestions">
    {#each suggestions as suggestion, i}
      <CopilotChatSuggestionPill
        {suggestion}
        index={i}
        isLoading={loadingIndexes.includes(i)}
        onSelect={() => onSelectSuggestion(suggestion, i)}
      />
    {/each}
  </div>
{/if}

<style>
  .copilotkit-suggestions {
    display: flex;
    gap: 8px;
    padding: 8px 16px;
    overflow-x: auto;
    flex-wrap: wrap;
  }
</style>
