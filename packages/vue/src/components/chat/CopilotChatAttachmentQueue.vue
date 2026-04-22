<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  formatFileSize,
  getDocumentIcon,
  getSourceUrl,
} from "@copilotkit/shared";
import type { Attachment } from "@copilotkit/shared";
import type { CopilotChatAttachmentQueueProps } from "./types";

const props = withDefaults(defineProps<CopilotChatAttachmentQueueProps>(), {
  attachments: () => [],
  className: "",
});

const emit = defineEmits<{
  "remove-attachment": [id: string];
}>();

const activeLightboxAttachment = ref<Attachment | null>(null);
const documentBlobUrl = ref<string | null>(null);

const isLightboxOpen = computed(() => activeLightboxAttachment.value !== null);
const isPreviewableDocument = computed(() => {
  const attachment = activeLightboxAttachment.value;
  if (!attachment || attachment.type !== "document") return false;
  const mimeType = attachment.source.mimeType;
  return isPdf(mimeType) || isText(mimeType);
});
const decodedTextPreview = computed(() => {
  const attachment = activeLightboxAttachment.value;
  if (!attachment || attachment.type !== "document") return null;
  const mimeType = attachment.source.mimeType;
  if (!isText(mimeType) || attachment.source.type !== "data") return null;
  try {
    return atob(attachment.source.value);
  } catch {
    return attachment.source.value;
  }
});
const lightboxDocumentSource = computed(() => {
  const attachment = activeLightboxAttachment.value;
  if (!attachment || attachment.type !== "document") return null;
  if (attachment.source.type === "url") return attachment.source.value;
  return documentBlobUrl.value;
});

watch(
  activeLightboxAttachment,
  (next, previous) => {
    if (documentBlobUrl.value) {
      URL.revokeObjectURL(documentBlobUrl.value);
      documentBlobUrl.value = null;
    }

    if (
      !next ||
      next.type !== "document" ||
      next.source.type !== "data" ||
      typeof window === "undefined"
    ) {
      return;
    }

    const mimeType = next.source.mimeType;
    if (!isPdf(mimeType) && !isText(mimeType)) {
      return;
    }

    const blobUrl = createBlobUrl(next.source.value, mimeType);
    documentBlobUrl.value = blobUrl;
  },
  { immediate: true },
);

watch(isLightboxOpen, (open, _previous, onCleanup) => {
  if (!open || typeof document === "undefined") return;

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      closeLightbox();
    }
  };
  document.addEventListener("keydown", handleKeydown);
  onCleanup(() => {
    document.removeEventListener("keydown", handleKeydown);
  });
});

onBeforeUnmount(() => {
  if (documentBlobUrl.value) {
    URL.revokeObjectURL(documentBlobUrl.value);
    documentBlobUrl.value = null;
  }
});

function openLightbox(attachment: Attachment) {
  if (typeof document !== "undefined") {
    const withTransition = document as Document & {
      startViewTransition?: (cb: () => void) => unknown;
    };
    if (typeof withTransition.startViewTransition === "function") {
      withTransition.startViewTransition(() => {
        activeLightboxAttachment.value = attachment;
      });
      return;
    }
  }
  activeLightboxAttachment.value = attachment;
}

function closeLightbox() {
  activeLightboxAttachment.value = null;
}

function cardClassName(attachment: Attachment) {
  if (attachment.type === "image" || attachment.type === "video") {
    return "cpk:w-[72px] cpk:h-[72px]";
  }
  if (attachment.type === "audio") {
    return "cpk:min-w-[200px] cpk:max-w-[280px] cpk:flex-col cpk:p-1 cpk:pr-8";
  }
  return "cpk:p-2 cpk:px-3 cpk:pr-8 cpk:max-w-[240px]";
}

function isPdf(mimeType: string | undefined): boolean {
  return !!mimeType && mimeType.includes("pdf");
}

function isText(mimeType: string | undefined): boolean {
  return !!mimeType && mimeType.startsWith("text/");
}

function createBlobUrl(
  base64Value: string,
  mimeType: string | undefined,
): string | null {
  try {
    const binary = atob(base64Value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], {
      type: mimeType || "application/octet-stream",
    });
    return URL.createObjectURL(blob);
  } catch (error) {
    console.error("[CopilotKit] Failed to decode attachment data:", error);
    return null;
  }
}
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
      class="cpk:relative cpk:inline-flex cpk:rounded-lg cpk:overflow-hidden cpk:border cpk:border-border"
      :class="cardClassName(attachment)"
      data-testid="copilot-chat-attachment-item"
      :data-card-type="attachment.type"
    >
      <div
        v-if="attachment.status === 'uploading'"
        class="cpk:absolute cpk:inset-0 cpk:flex cpk:items-center cpk:justify-center cpk:bg-black/40 cpk:z-10"
        data-testid="copilot-chat-attachment-uploading-overlay"
      >
        <div
          class="cpk:w-5 cpk:h-5 cpk:border-2 cpk:border-white cpk:border-t-transparent cpk:rounded-full cpk:animate-spin"
        />
      </div>

      <template v-if="attachment.status === 'ready'">
        <button
          v-if="attachment.type === 'image'"
          type="button"
          class="cpk:w-full cpk:h-full cpk:border-none cpk:bg-transparent cpk:p-0 cpk:cursor-pointer"
          data-testid="copilot-chat-attachment-image-button"
          @click="openLightbox(attachment)"
        >
          <img
            :src="getSourceUrl(attachment.source)"
            :alt="attachment.filename || 'Image attachment'"
            class="cpk:w-full cpk:h-full cpk:object-cover"
            data-testid="copilot-chat-attachment-image-thumbnail"
          />
        </button>

        <div
          v-else-if="attachment.type === 'video'"
          class="cpk:w-full cpk:h-full cpk:relative"
        >
          <img
            v-if="attachment.thumbnail"
            :src="attachment.thumbnail"
            :alt="attachment.filename || 'Video thumbnail'"
            class="cpk:w-full cpk:h-full cpk:object-cover"
            data-testid="copilot-chat-attachment-video-thumbnail"
          />
          <video
            v-else
            :src="getSourceUrl(attachment.source)"
            preload="metadata"
            muted
            class="cpk:w-full cpk:h-full cpk:object-cover"
            data-testid="copilot-chat-attachment-video-fallback"
          />
          <button
            type="button"
            class="cpk:absolute cpk:inset-0 cpk:flex cpk:items-center cpk:justify-center cpk:z-10 cpk:cursor-pointer cpk:bg-black/20 cpk:border-none cpk:p-0"
            aria-label="Play video"
            data-testid="copilot-chat-attachment-video-play"
            @click="openLightbox(attachment)"
          >
            <div
              class="cpk:w-8 cpk:h-8 cpk:rounded-full cpk:bg-black/60 cpk:flex cpk:items-center cpk:justify-center cpk:text-white cpk:text-xs cpk:font-semibold"
            >
              ▶
            </div>
          </button>
        </div>

        <div
          v-else-if="attachment.type === 'audio'"
          class="cpk:flex cpk:flex-col cpk:gap-1 cpk:w-full"
        >
          <audio
            :src="getSourceUrl(attachment.source)"
            controls
            preload="metadata"
            class="cpk:w-full cpk:h-8"
            data-testid="copilot-chat-attachment-audio-player"
          />
          <span
            v-if="attachment.filename"
            class="cpk:text-xs cpk:font-medium cpk:overflow-hidden cpk:text-ellipsis cpk:whitespace-nowrap"
          >
            {{ attachment.filename }}
          </span>
        </div>

        <button
          v-else
          type="button"
          class="cpk:flex cpk:items-center cpk:gap-2 cpk:w-full cpk:border-none cpk:bg-transparent cpk:p-0 cpk:text-left"
          :class="
            isPdf(attachment.source.mimeType) ||
            isText(attachment.source.mimeType)
              ? 'cpk:cursor-pointer'
              : 'cpk:cursor-default'
          "
          data-testid="copilot-chat-attachment-document-button"
          @click="
            (isPdf(attachment.source.mimeType) ||
              isText(attachment.source.mimeType)) &&
            openLightbox(attachment)
          "
        >
          <div
            class="cpk:w-8 cpk:h-8 cpk:rounded-md cpk:bg-primary cpk:text-primary-foreground cpk:flex cpk:items-center cpk:justify-center cpk:text-[10px] cpk:font-semibold cpk:shrink-0"
          >
            {{ getDocumentIcon(attachment.source.mimeType ?? "") }}
          </div>
          <div class="cpk:flex cpk:flex-col cpk:min-w-0">
            <span
              class="cpk:text-xs cpk:font-medium cpk:break-all cpk:leading-tight"
              data-testid="copilot-chat-attachment-document-filename"
            >
              {{ attachment.filename || "Document" }}
            </span>
            <span
              v-if="attachment.size != null"
              class="cpk:text-[11px] cpk:text-muted-foreground"
            >
              {{ formatFileSize(attachment.size) }}
            </span>
          </div>
        </button>
      </template>

      <div
        v-else
        class="cpk:w-full cpk:h-full cpk:bg-muted-foreground/20"
        data-testid="copilot-chat-attachment-placeholder"
      />

      <button
        type="button"
        class="cpk:absolute cpk:bg-black/60 cpk:text-white cpk:border-none cpk:rounded-full cpk:w-5 cpk:h-5 cpk:flex cpk:items-center cpk:justify-center cpk:cursor-pointer cpk:text-[10px] cpk:z-20 cpk:top-1 cpk:right-1"
        aria-label="Remove attachment"
        @click="emit('remove-attachment', attachment.id)"
      >
        ✕
      </button>
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="activeLightboxAttachment"
      class="cpk:fixed cpk:inset-0 cpk:z-[9999] cpk:flex cpk:items-center cpk:justify-center cpk:bg-black/80"
      data-testid="copilot-chat-attachment-lightbox"
      @click="closeLightbox"
    >
      <button
        type="button"
        class="cpk:absolute cpk:top-4 cpk:right-4 cpk:text-white cpk:bg-white/10 cpk:hover:bg-white/20 cpk:rounded-full cpk:w-10 cpk:h-10 cpk:flex cpk:items-center cpk:justify-center cpk:cursor-pointer cpk:border-none"
        aria-label="Close preview"
        @click.stop="closeLightbox"
      >
        ✕
      </button>

      <div data-testid="copilot-chat-attachment-lightbox-content" @click.stop>
        <img
          v-if="activeLightboxAttachment.type === 'image'"
          :src="getSourceUrl(activeLightboxAttachment.source)"
          :alt="activeLightboxAttachment.filename || 'Image attachment'"
          class="cpk:max-w-[90vw] cpk:max-h-[90vh] cpk:object-contain cpk:rounded-lg"
          data-testid="copilot-chat-attachment-lightbox-image"
        />

        <video
          v-else-if="activeLightboxAttachment.type === 'video'"
          :src="getSourceUrl(activeLightboxAttachment.source)"
          controls
          autoplay
          class="cpk:max-w-[90vw] cpk:max-h-[90vh] cpk:rounded-lg"
          data-testid="copilot-chat-attachment-lightbox-video"
        />

        <template v-else-if="activeLightboxAttachment.type === 'document'">
          <iframe
            v-if="
              isPreviewableDocument &&
              isPdf(activeLightboxAttachment.source.mimeType) &&
              lightboxDocumentSource
            "
            :src="lightboxDocumentSource"
            :title="activeLightboxAttachment.filename || 'PDF preview'"
            class="cpk:w-[90vw] cpk:h-[90vh] cpk:max-w-[1000px] cpk:rounded-lg cpk:bg-white"
            data-testid="copilot-chat-attachment-lightbox-document-iframe"
          />

          <div
            v-else-if="
              isPreviewableDocument &&
              isText(activeLightboxAttachment.source.mimeType)
            "
            class="cpk:w-[90vw] cpk:max-w-[800px] cpk:max-h-[90vh] cpk:overflow-auto cpk:rounded-lg cpk:bg-white cpk:dark:bg-gray-900 cpk:p-6"
          >
            <pre
              v-if="decodedTextPreview !== null"
              class="cpk:text-sm cpk:whitespace-pre-wrap cpk:wrap-break-word cpk:text-gray-800 cpk:dark:text-gray-200 cpk:font-mono cpk:m-0"
              data-testid="copilot-chat-attachment-lightbox-document-text"
              >{{ decodedTextPreview }}</pre
            >
            <iframe
              v-else-if="lightboxDocumentSource"
              :src="lightboxDocumentSource"
              :title="activeLightboxAttachment.filename || 'Text preview'"
              class="cpk:w-full cpk:h-[80vh] cpk:border-none"
              data-testid="copilot-chat-attachment-lightbox-document-iframe"
            />
          </div>

          <div
            v-else
            class="cpk:flex cpk:flex-col cpk:items-center cpk:gap-4 cpk:p-8 cpk:rounded-lg cpk:bg-white cpk:dark:bg-gray-900"
            data-testid="copilot-chat-attachment-lightbox-document-fallback"
          >
            <div
              class="cpk:w-16 cpk:h-16 cpk:rounded-xl cpk:bg-primary cpk:text-primary-foreground cpk:flex cpk:items-center cpk:justify-center cpk:text-xl cpk:font-bold"
            >
              {{
                getDocumentIcon(activeLightboxAttachment.source.mimeType ?? "")
              }}
            </div>
            <div class="cpk:text-center">
              <div
                class="cpk:text-base cpk:font-medium cpk:text-gray-800 cpk:dark:text-gray-200"
              >
                {{ activeLightboxAttachment.filename || "Document" }}
              </div>
              <div
                class="cpk:text-sm cpk:text-gray-500 cpk:dark:text-gray-400 cpk:mt-1"
              >
                {{ activeLightboxAttachment.source.mimeType || "Unknown type" }}
                {{
                  activeLightboxAttachment.size != null
                    ? ` · ${formatFileSize(activeLightboxAttachment.size)}`
                    : ""
                }}
              </div>
            </div>
            <div class="cpk:text-xs cpk:text-gray-400 cpk:dark:text-gray-500">
              No preview available for this file type
            </div>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>
