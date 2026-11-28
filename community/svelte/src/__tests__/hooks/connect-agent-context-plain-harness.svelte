<script lang="ts">
  import { setContext } from "svelte";
  import { connectAgentContext } from "../../hooks/connect-agent-context.svelte";
  import {
    COPILOT_KIT_KEY,
    type CopilotKitContextValue,
  } from "../../providers/context";

  let { context }: { context: CopilotKitContextValue } = $props();

  // svelte-ignore state_referenced_locally
  setContext(COPILOT_KIT_KEY, context);

  connectAgentContext({
    description: "test",
    value: "plain-value",
  });
</script>

<output data-testid="output">mounted</output>
