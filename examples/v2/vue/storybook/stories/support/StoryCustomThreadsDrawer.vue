<script setup lang="ts">
import type { CopilotModalThreadsDrawerSlotProps } from "@copilotkit/vue";
import { storyThreads } from "./fixtures";

/**
 * A replacement for the default drawer, rendered in a popup/sidebar's
 * `threads-drawer` slot, which hands it the open state and the chat's thread.
 * A real one would list threads with `useThreads()` (the stories use fixture
 * threads, having no runtime).
 */
defineProps<CopilotModalThreadsDrawerSlotProps>();
</script>

<template>
  <template v-if="isOpen">
    <div class="scrim" aria-hidden="true" @click="close" />
    <nav class="panel" aria-label="Recent chats">
      <strong class="title">Recent chats</strong>
      <button
        v-for="thread in storyThreads"
        :key="thread.id"
        type="button"
        class="row"
        :data-active="thread.id === threadId || undefined"
        @click="
          selectThread(thread.id);
          close();
        "
      >
        {{ thread.name }}
      </button>
    </nav>
  </template>
</template>

<style scoped>
/* Above the chat's docked input, like the default drawer. */
.scrim {
  position: absolute;
  inset: 0;
  z-index: 50;
  background: color-mix(in oklab, var(--foreground) 12%, transparent);
}
.panel {
  position: absolute;
  inset-block: 0;
  left: 0;
  z-index: 51;
  width: 240px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--card);
  color: var(--card-foreground);
  border-right: 1px solid var(--border);
}
.title {
  padding: 8px 10px;
  font-size: 13px;
}
.row {
  text-align: left;
  padding: 8px 10px;
  border-radius: 10px;
  font-size: 13px;
  background: transparent;
}
.row[data-active] {
  background: var(--accent);
}
</style>
