<!-- @region[interactive-generative-ui] -->
<script setup lang="ts">
import { ref } from "vue";
import { z } from "zod";
import { useFrontendTool } from "@copilotkit/vue/v2";

const theme = ref<"light" | "dark">("light");

useFrontendTool({
  name: "setTheme",
  description: "Change the dashboard color theme",
  parameters: z.object({
    theme: z.enum(["light", "dark"]),
  }),
  handler: async ({ theme: nextTheme }) => {
    theme.value = nextTheme;
    return `Theme changed to ${nextTheme}`;
  },
});
</script>

<template>
  <section :data-theme="theme">Current theme: {{ theme }}</section>
</template>
<!-- @endregion[interactive-generative-ui] -->
