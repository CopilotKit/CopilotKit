<!-- @region[display-only-generative-ui] -->
<script setup lang="ts">
import { CopilotChat } from "@copilotkit/vue/v2";
</script>

<template>
  <CopilotChat>
    <template #tool-call-getWeather="{ args, status, result }">
      <article>
        <strong>{{ args.city ?? "Your city" }}</strong>
        <p v-if="status === 'complete'">{{ result }}</p>
        <p v-else>Loading weather…</p>
      </article>
    </template>
  </CopilotChat>
</template>
<!-- @endregion[display-only-generative-ui] -->
