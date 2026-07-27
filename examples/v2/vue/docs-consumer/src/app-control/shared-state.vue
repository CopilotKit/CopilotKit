<!-- @region[shared-agent-state] -->
<script setup lang="ts">
import { computed } from "vue";
import { useAgent } from "@copilotkit/vue/v2";

const { agent } = useAgent({ agentId: "default" });
const count = computed(() => Number(agent.value?.state.count ?? 0));

function increment() {
  if (!agent.value) return;
  agent.value.setState({
    ...agent.value.state,
    count: count.value + 1,
  });
}
</script>

<template>
  <button type="button" @click="increment">Count: {{ count }}</button>
</template>
<!-- @endregion[shared-agent-state] -->
