<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { getDocumentIcon, getSourceUrl } from "@copilotkit/shared";
import type { CopilotChatAttachmentRendererProps } from "./types";

// Attributes (class, style, id…) go on the attachment element, not on the
// `display: contents` wrapper, where they would have no box to style.
defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<CopilotChatAttachmentRendererProps>(), {
  filename: undefined,
  className: "",
});

const imageLoadFailed = ref(false);
// Images render as a thumbnail; clicking one opens it full size.
const lightboxOpen = ref(false);

watch(lightboxOpen, (open, _previous, onCleanup) => {
  if (!open || typeof document === "undefined") return;
  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") lightboxOpen.value = false;
  };
  document.addEventListener("keydown", handleKeydown);
  onCleanup(() => document.removeEventListener("keydown", handleKeydown));
});
const sourceUrl = computed(() => getSourceUrl(props.source));
const documentLabel = computed(
  () => props.filename || props.source.mimeType || "Unknown type",
);
</script>

<template>
  <!-- Scopes tokens and preflight for standalone use; `contents` adds no box. -->
  <div data-copilotkit style="display: contents">
    <img
      v-if="props.type === 'image' && !imageLoadFailed"
      :src="sourceUrl"
      alt="Image attachment"
      class="cpk:max-w-[80px] cpk:max-h-[80px] cpk:w-auto cpk:h-auto cpk:rounded-xl cpk:object-cover cpk:cursor-pointer cpk:bg-muted"
      :class="props.className"
      data-testid="copilot-chat-attachment-renderer-image"
      v-bind="$attrs"
      @click="lightboxOpen = true"
      @error="imageLoadFailed = true"
    />
    <div
      v-else-if="props.type === 'image'"
      class="cpk:flex cpk:flex-col cpk:items-center cpk:justify-center cpk:rounded-xl cpk:bg-muted cpk:p-4 cpk:text-sm cpk:text-muted-foreground"
      :class="props.className"
      data-testid="copilot-chat-attachment-renderer-image-fallback"
      v-bind="$attrs"
    >
      <span>Failed to load image</span>
    </div>

    <div
      v-else-if="props.type === 'audio'"
      class="cpk:flex cpk:flex-col cpk:gap-1"
      :class="props.className"
      data-testid="copilot-chat-attachment-renderer-audio"
      v-bind="$attrs"
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
      v-bind="$attrs"
    />

    <div
      v-else
      class="cpk:inline-flex cpk:max-w-full cpk:items-center cpk:gap-2.5 cpk:py-2 cpk:pl-2 cpk:pr-3 cpk:border cpk:border-border cpk:rounded-xl cpk:bg-card"
      :class="props.className"
      data-testid="copilot-chat-attachment-renderer-document"
      v-bind="$attrs"
    >
      <span
        class="cpk:flex cpk:size-8 cpk:shrink-0 cpk:items-center cpk:justify-center cpk:rounded-lg cpk:bg-primary/10 cpk:text-[10px] cpk:font-semibold cpk:uppercase cpk:text-primary"
        data-testid="copilot-chat-attachment-renderer-document-icon"
      >
        {{ getDocumentIcon(props.source.mimeType ?? "") }}
      </span>
      <span
        class="cpk:text-sm cpk:text-foreground cpk:truncate"
        data-testid="copilot-chat-attachment-renderer-document-label"
      >
        {{ documentLabel }}
      </span>
    </div>
    <Teleport v-if="props.type === 'image' && lightboxOpen" to="body">
      <div
        data-copilotkit
        class="cpk:fixed cpk:inset-0 cpk:z-[9999] cpk:flex cpk:items-center cpk:justify-center cpk:bg-black/80 cpk:backdrop-blur-sm"
        data-testid="copilot-chat-attachment-renderer-lightbox"
        @click="lightboxOpen = false"
      >
        <button
          type="button"
          class="cpk:absolute cpk:top-4 cpk:right-4 cpk:text-white cpk:bg-white/10 cpk:hover:bg-white/20 cpk:rounded-full cpk:w-10 cpk:h-10 cpk:flex cpk:items-center cpk:justify-center cpk:cursor-pointer cpk:border-none"
          aria-label="Close preview"
          @click.stop="lightboxOpen = false"
        >
          ✕
        </button>
        <img
          :src="sourceUrl"
          alt="Image attachment"
          class="cpk:max-w-[90vw] cpk:max-h-[90vh] cpk:object-contain cpk:rounded-lg"
          @click.stop
        />
      </div>
    </Teleport>
  </div>
</template>
