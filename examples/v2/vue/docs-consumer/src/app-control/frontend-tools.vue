<!-- @region[frontend-tool] -->
<script setup lang="ts">
import { ref } from "vue";
import { z } from "zod";
import { useFrontendTool } from "@copilotkit/vue/v2";

const todos = ref<string[]>([]);

useFrontendTool({
  name: "addTodo",
  description: "Add a todo to the current list",
  parameters: z.object({
    title: z.string(),
  }),
  handler: async ({ title }) => {
    todos.value.push(title);
    return `Added ${title}`;
  },
});
</script>

<template>
  <ul>
    <li v-for="todo in todos" :key="todo">{{ todo }}</li>
  </ul>
</template>
<!-- @endregion[frontend-tool] -->
