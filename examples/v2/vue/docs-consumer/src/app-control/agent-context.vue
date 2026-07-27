<!-- @region[agent-context] -->
<script setup lang="ts">
import { ref } from "vue";
import { useAgentContext } from "@copilotkit/vue/v2";

const selectedProject = ref("documentation");

useAgentContext({
  description: "The project currently selected by the user",
  value: () => ({ project: selectedProject.value }),
});
</script>

<template>
  <select v-model="selectedProject">
    <option value="documentation">Documentation</option>
    <option value="dashboard">Dashboard</option>
  </select>
</template>
<!-- @endregion[agent-context] -->
