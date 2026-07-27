<!-- @region[component-slots] -->
<script setup lang="ts">
import { CopilotChat } from "@copilotkit/vue/v2";
</script>

<template>
  <CopilotChat>
    <template #welcome-message>
      <h2>How can I help with your workspace?</h2>
    </template>

    <template #scroll-to-bottom-button="{ onClick }">
      <button type="button" @click="onClick">Jump to latest</button>
    </template>
  </CopilotChat>
</template>
<!-- @endregion[component-slots] -->
