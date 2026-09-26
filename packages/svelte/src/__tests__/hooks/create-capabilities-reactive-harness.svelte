<script lang="ts">
  import { setContext } from "svelte";
  import { createCapabilities } from "../../hooks/create-capabilities.svelte";
  import {
    COPILOT_KIT_KEY,
    type CopilotKitContextValue,
  } from "../../providers/context";

  let { context }: { context: CopilotKitContextValue } = $props();

  // svelte-ignore state_referenced_locally
  setContext(COPILOT_KIT_KEY, context);

  let agentId = $state("agent-a");

  const caps = createCapabilities(() => agentId);
  const rendered = $derived(JSON.stringify(caps.capabilities ?? null));
</script>

<output data-testid="capabilities">{rendered}</output>
<button data-testid="switch" onclick={() => agentId = "agent-b"}>Switch</button>
