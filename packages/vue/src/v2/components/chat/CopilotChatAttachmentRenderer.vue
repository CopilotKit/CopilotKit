<script setup lang="ts">
import { computed, ref } from "vue";
import { getDocumentIcon, getSourceUrl } from "@copilotkit/shared";
import type { CopilotChatAttachmentRendererProps } from "./types";

const props = withDefaults(defineProps<CopilotChatAttachmentRendererProps>(), {
  filename: undefined,
  className: "",
});

const imageLoadFailed = ref(false);
const sourceUrl = computed(() => getSourceUrl(props.source));
const documentLabel = computed(
  () => props.filename || props.source.mimeType || "Unknown type",
);
</script>

<template>
  <img
    v-if="props.type === 'image' && !imageLoadFailed"
    :src="sourceUrl"
    alt="Image attachment"
    class="cpk:max-w-full cpk:h-auto cpk:rounded-lg"
    :class="props.className"
    data-testid="copilot-chat-attachment-renderer-image"
    @error="imageLoadFailed = true"
  />
  <div
    v-else-if="props.type === 'image'"
    class="cpk:flex cpk:flex-col cpk:items-center cpk:justify-center cpk:rounded-lg cpk:bg-muted cpk:p-4 cpk:text-sm cpk:text-muted-foreground"
    :class="props.className"
    data-testid="copilot-chat-attachment-renderer-image-fallback"
  >
    <span>Failed to load image</span>
  </div>

  <div
    v-else-if="props.type === 'audio'"
    class="cpk:flex cpk:flex-col cpk:gap-1"
    :class="props.className"
    data-testid="copilot-chat-attachment-renderer-audio"
  >
    <audio
      :src="sourceUrl"
      controls
      preload="metadata"
      class="cpk:max-w-[300px] cpk:w-full cpk:h-10"
    />
    <span
      v-if="props.filename"
      class="cpk:text-xs cpk:text-muted-foreground cpk:truncate cpk:max-w-[300px]"
      data-testid="copilot-chat-attachment-renderer-audio-filename"
    >
      {{ props.filename }}
    </span>
  </div>

  <video
    v-else-if="props.type === 'video'"
    :src="sourceUrl"
    controls
    preload="metadata"
    class="cpk:max-w-[400px] cpk:w-full cpk:rounded-lg"
    :class="props.className"
    data-testid="copilot-chat-attachment-renderer-video"
  />

  <div
    v-else
    class="cpk:inline-flex cpk:items-center cpk:gap-2 cpk:px-3 cpk:py-2 cpk:border cpk:border-border cpk:rounded-lg cpk:bg-muted"
    :class="props.className"
    data-testid="copilot-chat-attachment-renderer-document"
  >
    <span
      class="cpk:text-xs cpk:font-bold cpk:uppercase"
      data-testid="copilot-chat-attachment-renderer-document-icon"
    >
      {{ getDocumentIcon(props.source.mimeType ?? "") }}
    </span>
    <span
      class="cpk:text-sm cpk:text-muted-foreground cpk:truncate"
      data-testid="copilot-chat-attachment-renderer-document-label"
    >
      {{ documentLabel }}
    </span>
  </div>
</template>
