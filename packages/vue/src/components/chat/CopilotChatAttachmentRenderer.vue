<script setup lang="ts">
import { computed, ref } from "vue";
import { getDocumentIcon, getSourceUrl } from "@copilotkit/shared";
import type { CopilotChatAttachmentRendererProps } from "./types";
import CopilotChatLightbox from "./CopilotChatLightbox.vue";
import { useLightbox } from "./use-lightbox";
import { useChatLabels } from "./use-chat-labels";

const props = withDefaults(defineProps<CopilotChatAttachmentRendererProps>(), {
  filename: undefined,
  className: "",
});

const labels = useChatLabels();
const imageLoadFailed = ref(false);
const sourceUrl = computed(() => getSourceUrl(props.source));
const documentLabel = computed(
  () =>
    props.filename ||
    props.source.mimeType ||
    labels.value.attachmentUnknownTypeText,
);
const documentAriaLabel = computed(
  () =>
    props.filename ||
    props.source.mimeType ||
    labels.value.attachmentDocumentAltText,
);

const imageButton = ref<HTMLButtonElement | null>(null);
const {
  thumbnailRef,
  vtName,
  open: lightboxOpen,
  openLightbox,
  closeLightbox,
} = useLightbox();
</script>

<template>
  <!-- React opens the lightbox from the <img>; a button around it lets
       keyboard users open it too. The button has no look of its own. -->
  <button
    v-if="props.type === 'image' && !imageLoadFailed"
    ref="imageButton"
    type="button"
    class="cpk-attachment-renderer-image-button"
    data-testid="copilot-chat-attachment-renderer-image-button"
    @click="openLightbox"
  >
    <img
      ref="thumbnailRef"
      :src="sourceUrl"
      :alt="labels.attachmentImageAltText"
      class="cpk-attachment-renderer cpk-attachment-renderer-image"
      :class="props.className"
      data-testid="copilot-chat-attachment-renderer-image"
      @error="imageLoadFailed = true"
    />
    <!-- Teleported to the body; inside the button only to keep one root. -->
    <CopilotChatLightbox
      v-if="lightboxOpen"
      :label="labels.attachmentImageAltText"
      :return-focus-to="imageButton"
      @close="closeLightbox"
    >
      <img
        :style="{ viewTransitionName: vtName }"
        :src="sourceUrl"
        :alt="labels.attachmentImageAltText"
        class="cpk-attachment-renderer-lightbox-image"
        data-testid="copilot-chat-attachment-renderer-lightbox-image"
      />
    </CopilotChatLightbox>
  </button>
  <div
    v-else-if="props.type === 'image'"
    class="cpk-attachment-renderer cpk-attachment-renderer-image-error"
    :class="props.className"
    data-testid="copilot-chat-attachment-renderer-image-fallback"
  >
    <span>{{ labels.attachmentImageLoadErrorText }}</span>
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

  <!-- `download` is honoured for same-origin, data: and blob: URLs. Browsers
       ignore it for cross-origin URLs unless the server sends
       `Content-Disposition: attachment`; `target="_blank"` keeps those from
       navigating the chat away and opens the file in a new tab instead. -->
  <a
    v-else
    :href="sourceUrl"
    :download="props.filename ?? ''"
    target="_blank"
    rel="noopener noreferrer"
    :aria-label="documentAriaLabel"
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
  </a>
</template>
