<script lang="ts">
  import { setContext } from "svelte";
  import { createAgent } from "../../hooks/create-agent.svelte";
  import {
    COPILOT_KIT_KEY,
    type CopilotKitContextValue,
  } from "../../providers/context";

  let { context }: { context: CopilotKitContextValue } = $props();

  // svelte-ignore state_referenced_locally
  setContext(COPILOT_KIT_KEY, context);

  const agentHook = createAgent({ agentId: "test-agent" });
  const renderedState = $derived(JSON.stringify(agentHook.agent?.state ?? null));
</script>

<output data-testid="agent-state">{renderedState}</output>
