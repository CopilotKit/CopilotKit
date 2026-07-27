<!-- @region[ag-ui-agent-events] -->
<script setup lang="ts">
import { onScopeDispose, watch } from "vue";
import { useAgent } from "@copilotkit/vue/v2";

const { agent } = useAgent({ agentId: "research-agent" });

const stopWatching = watch(
  agent,
  (currentAgent, _previousAgent, onCleanup) => {
    if (!currentAgent) return;

    const subscription = currentAgent.subscribe({
      onEvent({ event }) {
        console.log("Event:", event.type);
      },
      onTextMessageContentEvent({ textMessageBuffer }) {
        console.log("Streaming text:", textMessageBuffer);
      },
      onToolCallEndEvent({ toolCallName, toolCallArgs }) {
        console.log("Tool called:", toolCallName, toolCallArgs);
      },
      onStateChanged({ agent: updatedAgent }) {
        console.log("State changed:", updatedAgent.state);
      },
    });

    onCleanup(() => subscription.unsubscribe());
  },
  { immediate: true },
);

onScopeDispose(stopWatching);
</script>

<template>
  <p>
    {{ agent ? `Connected to ${agent.agentId}` : "Connecting to agent…" }}
  </p>
</template>
<!-- @endregion[ag-ui-agent-events] -->
