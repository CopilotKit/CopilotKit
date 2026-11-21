<script lang="ts">
  import type { AbstractAgent } from "@ag-ui/client";
  import { setContext } from "svelte";
  import { createAgent } from "../../hooks/create-agent.svelte";
  import {
    COPILOT_KIT_KEY,
    type CopilotKitContextValue,
  } from "../../providers/context";

  let {
    context,
    threadId,
  }: {
    context: CopilotKitContextValue;
    threadId: string;
  } = $props();

  // svelte-ignore state_referenced_locally
  setContext(COPILOT_KIT_KEY, context);
  const agentHandle = createAgent({
    get threadId() {
      return threadId;
    },
  });
  const agent = $derived(agentHandle.agent as AbstractAgent | null);
</script>

<output data-testid="thread-clone">{agent?.threadId ?? ""}</output>
