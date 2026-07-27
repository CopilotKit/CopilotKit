<!-- @region[programmatic-agent-control] -->
<script setup lang="ts">
import { computed } from "vue";
import { useAgent, UseAgentUpdate } from "@copilotkit/vue/v2";

const { agent } = useAgent({
  agentId: "default",
  updates: [
    UseAgentUpdate.OnMessagesChanged,
    UseAgentUpdate.OnRunStatusChanged,
  ],
});

const messageCount = computed(() => agent.value?.messages.length ?? 0);

function clearConversation() {
  agent.value?.setMessages([]);
}
</script>

<template>
  <button type="button" @click="clearConversation">
    Clear {{ messageCount }} messages
  </button>
</template>
<!-- @endregion[programmatic-agent-control] -->
