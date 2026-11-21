<script lang="ts">
  import { z } from "zod";
  import { registerFrontendTool } from "../../hooks/register-frontend-tool.svelte";
  import { useCopilotKit } from "../../providers/useCopilotKit";

  registerFrontendTool({
    name: "showToast",
    description: "Show a toast notification",
    parameters: z.object({ message: z.string() }),
    handler: async ({ message }) => `Toast shown: ${message}`,
  });

  const { copilotkit } = useCopilotKit();
  let registered = $state(false);
</script>

<button
  data-testid="check-frontend-tool"
  onclick={() => {
    registered = !!copilotkit.getTool({ toolName: "showToast" });
  }}
>
  check tool
</button>
<output data-testid="frontend-tool-registered">{registered}</output>
