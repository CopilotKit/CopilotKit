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
    class="cpk-attachment-renderer cpk-attachment-renderer-image"
    :class="props.className"
    data-testid="copilot-chat-attachment-renderer-image"
    @error="imageLoadFailed = true"
  />
  <div
    v-else-if="props.type === 'image'"
    class="cpk-attachment-renderer cpk-attachment-renderer-image-error"
    :class="props.className"
    data-testid="copilot-chat-attachment-renderer-image-fallback"
  >
    <span>Failed to load image</span>
  </div>

  <div
    v-else-if="props.type === 'audio'"
    class="cpk-attachment-renderer cpk-attachment-renderer-audio"
    :class="props.className"
    data-testid="copilot-chat-attachment-renderer-audio"
  >
    <audio
      :src="sourceUrl"
      controls
      preload="metadata"
      class="cpk-attachment-renderer-audio-player"
    />
    <span
      v-if="props.filename"
      class="cpk-attachment-renderer-audio-filename"
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
    class="cpk-attachment-renderer cpk-attachment-renderer-video"
    :class="props.className"
    data-testid="copilot-chat-attachment-renderer-video"
  />

  <div
    v-else
    class="cpk-attachment-renderer cpk-attachment-renderer-document"
    :class="props.className"
    data-testid="copilot-chat-attachment-renderer-document"
  >
    <span
      class="cpk-attachment-renderer-document-icon"
      data-testid="copilot-chat-attachment-renderer-document-icon"
    >
      {{ getDocumentIcon(props.source.mimeType ?? "") }}
    </span>
    <span
      class="cpk-attachment-renderer-document-name"
      data-testid="copilot-chat-attachment-renderer-document-label"
    >
      {{ documentLabel }}
    </span>
  </div>
</template>
