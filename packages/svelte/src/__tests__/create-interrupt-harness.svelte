<script lang="ts">
  import { setContext } from "svelte";
  import { createInterrupt } from "../hooks/create-interrupt.svelte";
  import {
    COPILOT_KIT_KEY,
    type CopilotKitContextValue,
  } from "../providers/context";

  let { context }: { context: CopilotKitContextValue } = $props();

  // svelte-ignore state_referenced_locally
  setContext(COPILOT_KIT_KEY, context);

  const interrupt = createInterrupt({ agentId: "test-agent" });
  const rendered = $derived(
    JSON.stringify({
      hasInterrupt: interrupt.hasInterrupt,
      interrupt: interrupt.interrupt,
    }),
  );
</script>

<output data-testid="interrupt-state">{rendered}</output>
