<script lang="ts">
  import { setContext } from "svelte";
  import { createSuggestions } from "../../hooks/create-suggestions.svelte";
  import {
    COPILOT_KIT_KEY,
    type CopilotKitContextValue,
  } from "../../providers/context";

  let { context }: { context: CopilotKitContextValue } = $props();

  // svelte-ignore state_referenced_locally
  setContext(COPILOT_KIT_KEY, context);

  let agentId = $state("agent-a");

  const sugg = createSuggestions({ agentId: () => agentId });
  const rendered = $derived(JSON.stringify({ suggestions: sugg.suggestions, isLoading: sugg.isLoading }));
</script>

<output data-testid="suggestions">{rendered}</output>
<button data-testid="switch" onclick={() => agentId = "agent-b"}>Switch</button>
