<script setup lang="ts">
import CopilotChatAttachmentRenderer from "./CopilotChatAttachmentRenderer.vue";
import type { CopilotChatAttachmentQueueProps } from "./types";

const props = withDefaults(defineProps<CopilotChatAttachmentQueueProps>(), {
  attachments: () => [],
  className: "",
});

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
      class="cpk:relative cpk:flex cpk:items-center cpk:gap-2 cpk:max-w-[320px] cpk:rounded-lg cpk:border cpk:border-border cpk:bg-muted cpk:px-3 cpk:py-2"
      data-testid="copilot-chat-attachment-item"
    >
      <div
        class="cpk:relative cpk:flex cpk:items-center cpk:justify-center cpk:max-w-[72px] cpk:max-h-[72px] cpk:overflow-hidden cpk:rounded-md"
      >
        <CopilotChatAttachmentRenderer
          v-if="attachment.status === 'ready'"
          :type="attachment.type"
          :source="attachment.source"
          :filename="attachment.filename"
          class-name="cpk:max-w-[72px] cpk:max-h-[72px] cpk:object-cover"
        />
        <div
          v-else
          class="cpk:w-[72px] cpk:h-[72px] cpk:rounded-md cpk:bg-muted-foreground/20"
          data-testid="copilot-chat-attachment-placeholder"
        />
        <div
          v-if="attachment.status === 'uploading'"
          class="cpk:absolute cpk:inset-0 cpk:flex cpk:items-center cpk:justify-center cpk:bg-black/40"
          data-testid="copilot-chat-attachment-uploading-overlay"
        >
          <div
            class="cpk:w-5 cpk:h-5 cpk:border-2 cpk:border-white cpk:border-t-transparent cpk:rounded-full cpk:animate-spin"
          />
        </div>
      </div>
      <span class="cpk:text-xs cpk:font-medium cpk:truncate">
        {{ attachment.filename || "Attachment" }}
      </span>
      <span class="cpk:text-[11px] cpk:text-muted-foreground">
        {{ attachment.status }}
      </span>
      <button
        type="button"
        class="cpk:ml-auto cpk:inline-flex cpk:h-5 cpk:w-5 cpk:items-center cpk:justify-center cpk:rounded-full cpk:bg-transparent cpk:text-[#444444] cpk:transition-colors cpk:duration-150 cpk:ease-out cpk:hover:scale-105 cpk:hover:bg-[#f8f8f8] cpk:hover:text-[#333333] cpk:dark:text-white cpk:dark:hover:bg-[#404040] cpk:dark:hover:text-[#FFFFFF]"
        aria-label="Remove attachment"
        @click="emit('remove-attachment', attachment.id)"
      >
        x
      </button>
    </div>
  </div>
</template>
