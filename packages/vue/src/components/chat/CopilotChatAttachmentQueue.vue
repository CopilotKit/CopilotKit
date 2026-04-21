<script setup lang="ts">
import type { Attachment } from "@copilotkit/shared";

const props = withDefaults(
  defineProps<{
    attachments: Attachment[];
    className?: string;
  }>(),
  {
    attachments: () => [],
    className: "",
  },
);

const emit = defineEmits<{
  "remove-attachment": [id: string];
}>();
</script>

<template>
  <div
    v-if="props.attachments.length > 0"
    class="cpk:flex cpk:flex-wrap cpk:gap-2 cpk:p-2"
    :class="props.className"
    data-testid="copilot-chat-attachment-queue"
  >
    <div
      v-for="attachment in props.attachments"
      :key="attachment.id"
      class="cpk:flex cpk:items-center cpk:gap-2 cpk:max-w-[280px] cpk:rounded-lg cpk:border cpk:border-border cpk:bg-muted cpk:px-3 cpk:py-2"
      data-testid="copilot-chat-attachment-item"
    >
      <span class="cpk:text-xs cpk:font-medium cpk:truncate">
        {{ attachment.filename || "Attachment" }}
      </span>
      <span class="cpk:text-[11px] cpk:text-muted-foreground">
        {{ attachment.status }}
      </span>
      <button
        type="button"
        class="cpk:ml-auto cpk:inline-flex cpk:h-5 cpk:w-5 cpk:items-center cpk:justify-center cpk:rounded-full cpk:bg-transparent cpk:text-[#444444] cpk:transition-transform cpk:transition-colors cpk:duration-150 cpk:ease-out cpk:hover:scale-105 cpk:hover:bg-[#f8f8f8] cpk:hover:text-[#333333] cpk:dark:text-white cpk:dark:hover:bg-[#404040] cpk:dark:hover:text-[#FFFFFF]"
        aria-label="Remove attachment"
        @click="emit('remove-attachment', attachment.id)"
      >
        x
      </button>
    </div>
  </div>
</template>
