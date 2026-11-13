<script lang="ts">
  import { z } from "zod";
  import CopilotKitProvider from "../../providers/CopilotKitProvider.svelte";
  import type { SvelteHumanInTheLoop } from "../../types";

  const humanInTheLoop: SvelteHumanInTheLoop[] = [
    {
      name: "approve-action",
      description: "Approve the action",
      parameters: z.object({ topic: z.string() }),
      render: () => "unused",
    },
  ];
</script>

<CopilotKitProvider {humanInTheLoop} />
