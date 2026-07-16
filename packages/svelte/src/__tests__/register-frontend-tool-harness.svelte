<script lang="ts">
  import { setContext } from "svelte";
  import { registerFrontendTool } from "../hooks/register-frontend-tool.svelte";
  import {
    COPILOT_KIT_KEY,
    type CopilotKitContextValue,
  } from "../providers/context";

  let { context }: { context: CopilotKitContextValue } = $props();

  // svelte-ignore state_referenced_locally
  setContext(COPILOT_KIT_KEY, context);

  registerFrontendTool({
    name: "test-tool",
    description: "A test tool",
    parameters: { type: "object", properties: {} },
    handler: async () => "done",
    render: () => "rendered",
  });
</script>

<output>frontend tool harness</output>
