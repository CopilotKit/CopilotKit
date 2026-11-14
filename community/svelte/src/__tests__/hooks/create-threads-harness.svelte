<script lang="ts">
  import { setContext } from "svelte";
  import { createThreads } from "../../hooks/create-threads.svelte";
  import {
    COPILOT_KIT_KEY,
    type CopilotKitContextValue,
  } from "../../providers/context";

  let { context, agentId }: { context: CopilotKitContextValue; agentId: string } = $props();

  // svelte-ignore state_referenced_locally
  setContext(COPILOT_KIT_KEY, context);

  // svelte-ignore state_referenced_locally
  const threadsResult = createThreads({ agentId });
  const rendered = $derived(JSON.stringify({
    threads: threadsResult.threads,
    isLoading: threadsResult.isLoading,
    error: threadsResult.error?.message ?? null,
  }));
</script>

<output data-testid="threads">{rendered}</output>
