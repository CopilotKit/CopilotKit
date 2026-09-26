<script lang="ts">
  import { setContext } from "svelte";
  import { createInterrupt } from "../../hooks/create-interrupt.svelte";
  import {
    COPILOT_KIT_KEY,
    type CopilotKitContextValue,
  } from "../../providers/context";

  let { context }: { context: CopilotKitContextValue } = $props();
  // svelte-ignore state_referenced_locally
  setContext(COPILOT_KIT_KEY, context);

  let agentId = $state("agent-a");
  const interrupt = createInterrupt({ agentId: () => agentId });
</script>

<button data-testid="switch" onclick={() => (agentId = "agent-b")}>switch</button>
<output data-testid="has-interrupt">{String(interrupt.hasInterrupt)}</output>
