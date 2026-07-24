<script lang="ts">
  import { z } from "zod";
  import { setContext } from "svelte";
  import { registerHumanInTheLoop } from "../../hooks/register-human-in-the-loop.svelte";
  import {
    COPILOT_KIT_KEY,
    type CopilotKitContextValue,
  } from "../../providers/context";

  let {
    context,
    onRender,
  }: {
    context: CopilotKitContextValue;
    onRender: (props: Record<string, unknown>) => unknown;
  } = $props();
  // svelte-ignore state_referenced_locally
  setContext(COPILOT_KIT_KEY, context);

  // svelte-ignore state_referenced_locally
  registerHumanInTheLoop({
    name: "approve-action",
    description: "Approve the action",
    parameters: z.object({ action: z.string() }),
    render: onRender as never,
  });
</script>

<div data-testid="mounted">mounted</div>
