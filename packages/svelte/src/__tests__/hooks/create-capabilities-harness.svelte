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

  const cap = createCapabilities("test-agent");
  const rendered = $derived(JSON.stringify(cap.capabilities ?? null));
</script>

<output data-testid="capabilities">{rendered}</output>
