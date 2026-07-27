<!-- @region[programmatic-agent-control] -->
<script setup lang="ts">
import { computed } from "vue";
import { useAgent, useCopilotKit, UseAgentUpdate } from "@copilotkit/vue/v2";

const { copilotkit } = useCopilotKit();
const { agent } = useAgent({
  agentId: "default",
  updates: [
    UseAgentUpdate.OnMessagesChanged,
    UseAgentUpdate.OnRunStatusChanged,
  ],
});

const isRunning = computed(() => agent.value?.isRunning ?? false);

async function runAgent() {
  const currentAgent = agent.value;
  if (!currentAgent || currentAgent.isRunning) return;

  currentAgent.addMessage({
    id: crypto.randomUUID(),
    role: "user",
    content: "Summarize the latest sales data.",
  });

  await copilotkit.value.runAgent({ agent: currentAgent });
}

function stopAgent() {
  const currentAgent = agent.value;
  if (currentAgent) {
    copilotkit.value.stopAgent({ agent: currentAgent });
  }
}
</script>

<template>
  <button type="button" :disabled="!agent || isRunning" @click="runAgent">
    Run agent
  </button>
  <button v-if="isRunning" type="button" @click="stopAgent">Stop agent</button>
</template>
<!-- @endregion[programmatic-agent-control] -->
