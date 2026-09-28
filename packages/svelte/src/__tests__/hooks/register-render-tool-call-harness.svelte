<script lang="ts">
  import { setContext } from "svelte";
  import { registerRenderToolCall } from "../../hooks/register-render-tool-call.svelte";
  import {
    COPILOT_KIT_KEY,
    type CopilotKitContextValue,
  } from "../../providers/context";

  let { context }: { context: CopilotKitContextValue } = $props();

  // svelte-ignore state_referenced_locally
  setContext(COPILOT_KIT_KEY, context);

  registerRenderToolCall({
    name: "test-renderer",
    render: () => "rendered",
  });
</script>

<output>render tool call harness</output>
