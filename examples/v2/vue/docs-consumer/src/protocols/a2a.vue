<!-- @region[a2a-tool-rendering] -->
<script setup lang="ts">
import { h } from "vue";
import { z } from "zod";
import { useRenderTool } from "@copilotkit/vue/v2";
import type { RenderToolProps } from "@copilotkit/vue/v2";

const a2aMessageParameters = z.object({
  agentName: z.string(),
  task: z.string(),
});

useRenderTool({
  name: "send_message_to_a2a_agent",
  parameters: a2aMessageParameters,
  render: (props: RenderToolProps<typeof a2aMessageParameters>) =>
    h("article", { class: "a2a-message" }, [
      h("strong", `Orchestrator → ${props.parameters.agentName ?? "agent"}`),
      h("p", props.parameters.task ?? "Preparing the request…"),
      h(
        "p",
        props.status === "complete"
          ? (props.result ?? "Response received")
          : "Waiting for the A2A agent…",
      ),
    ]),
});
</script>

<template>
  <p>A2A agent communication is rendered in the chat.</p>
</template>
<!-- @endregion[a2a-tool-rendering] -->
