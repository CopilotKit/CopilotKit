<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  formatFileSize,
  getDocumentIcon,
  getSourceUrl,
} from "@copilotkit/shared";
import type { Attachment } from "@copilotkit/shared";
import type { CopilotChatAttachmentQueueProps } from "./types";
import { IconPlay, IconX } from "../icons";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { CopilotChatDefaultLabels } from "../../providers/types";

const props = withDefaults(defineProps<CopilotChatAttachmentQueueProps>(), {
  attachments: () => [],
  className: "",
});

const emit = defineEmits<{
  "remove-attachment": [id: string];
}>();

const config = useCopilotChatConfiguration();
const labels = computed(() => config.value?.labels ?? CopilotChatDefaultLabels);

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
    return "cpk-attachment-queue-item-media";
  }
  if (attachment.type === "audio") {
    return "cpk-attachment-queue-item-audio";
  }
  return "cpk-attachment-queue-item-document";
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
    class="cpk-attachment-queue"
    :class="props.className"
    data-testid="copilot-chat-attachment-queue"
  >
    <div
      v-for="attachment in props.attachments"
      :key="attachment.id"
      class="cpk-attachment-queue-item"
      :class="cardClassName(attachment)"
      data-testid="copilot-chat-attachment-item"
      :data-card-type="attachment.type"
    >
      <div
        v-if="attachment.status === 'uploading'"
        class="cpk-attachment-queue-uploading-overlay"
        data-testid="copilot-chat-attachment-uploading-overlay"
      >
        <div class="cpk-attachment-queue-uploading-spinner" />
      </div>

      <template v-if="attachment.status === 'ready'">
        <button
          v-if="attachment.type === 'image'"
          type="button"
          class="cpk-attachment-queue-preview-button"
          data-testid="copilot-chat-attachment-image-button"
          @click="openLightbox(attachment)"
        >
          <img
            :src="getSourceUrl(attachment.source)"
            :alt="attachment.filename || 'Image attachment'"
            class="cpk-attachment-queue-image"
            data-testid="copilot-chat-attachment-image-thumbnail"
          />
        </button>

        <template v-else-if="attachment.type === 'video'">
          <div class="cpk-attachment-queue-video">
            <img
              v-if="attachment.thumbnail"
              :src="attachment.thumbnail"
              :alt="attachment.filename || 'Video thumbnail'"
              class="cpk-attachment-queue-video-thumbnail"
              data-testid="copilot-chat-attachment-video-thumbnail"
            />
            <video
              v-else
              :src="getSourceUrl(attachment.source)"
              preload="metadata"
              muted
              class="cpk-attachment-queue-video-thumbnail"
              data-testid="copilot-chat-attachment-video-fallback"
            />
          </div>
          <button
            type="button"
            class="cpk-attachment-queue-video-play-button"
            :aria-label="labels.attachmentPlayVideoButtonLabel"
            data-testid="copilot-chat-attachment-video-play"
            @click="openLightbox(attachment)"
          >
            <div class="cpk-attachment-queue-video-play-badge">
              <IconPlay class="cpk-attachment-queue-video-play-icon" />
            </div>
          </button>
        </template>

        <div
          v-else-if="attachment.type === 'audio'"
          class="cpk-attachment-queue-audio"
        >
          <audio
            :src="getSourceUrl(attachment.source)"
            controls
            preload="metadata"
            class="cpk-attachment-queue-audio-player"
            data-testid="copilot-chat-attachment-audio-player"
          />
          <span
            v-if="attachment.filename"
            class="cpk-attachment-queue-audio-filename"
          >
            {{ attachment.filename }}
          </span>
        </div>

        <button
          v-else
          type="button"
          class="cpk-attachment-queue-preview-button cpk-attachment-queue-document"
          :class="{
            'cpk-attachment-queue-document-previewable':
              isPdf(attachment.source.mimeType) ||
              isText(attachment.source.mimeType),
          }"
          data-testid="copilot-chat-attachment-document-button"
          @click="
            (isPdf(attachment.source.mimeType) ||
              isText(attachment.source.mimeType)) &&
            openLightbox(attachment)
          "
        >
          <div class="cpk-attachment-queue-document-icon">
            {{ getDocumentIcon(attachment.source.mimeType ?? "") }}
          </div>
          <div class="cpk-attachment-queue-document-info">
            <span
              class="cpk-attachment-queue-document-name"
              data-testid="copilot-chat-attachment-document-filename"
            >
              {{ attachment.filename || "Document" }}
            </span>
            <span
              v-if="attachment.size != null"
              class="cpk-attachment-queue-document-size"
            >
              {{ formatFileSize(attachment.size) }}
            </span>
          </div>
        </button>
      </template>

      <div
        v-else
        class="cpk-attachment-queue-placeholder"
        data-testid="copilot-chat-attachment-placeholder"
      />

      <button
        type="button"
        class="cpk-attachment-queue-remove-button"
        :aria-label="labels.attachmentRemoveButtonLabel"
        @click="emit('remove-attachment', attachment.id)"
      >
        ✕
      </button>
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="activeLightboxAttachment"
      class="cpk-attachment-lightbox"
      data-testid="copilot-chat-attachment-lightbox"
      @click="closeLightbox"
    >
      <button
        type="button"
        class="cpk-attachment-lightbox-close-button"
        :aria-label="labels.attachmentPreviewCloseButtonLabel"
        @click.stop="closeLightbox"
      >
        <IconX class="cpk-attachment-lightbox-close-icon" />
      </button>

      <div data-testid="copilot-chat-attachment-lightbox-content" @click.stop>
        <img
          v-if="activeLightboxAttachment.type === 'image'"
          :src="getSourceUrl(activeLightboxAttachment.source)"
          :alt="activeLightboxAttachment.filename || 'Image attachment'"
          class="cpk-attachment-queue-lightbox-image"
          data-testid="copilot-chat-attachment-lightbox-image"
        />

        <video
          v-else-if="activeLightboxAttachment.type === 'video'"
          :src="getSourceUrl(activeLightboxAttachment.source)"
          controls
          autoplay
          class="cpk-attachment-queue-lightbox-video"
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
            class="cpk-attachment-queue-pdf-preview"
            data-testid="copilot-chat-attachment-lightbox-document-iframe"
          />

          <div
            v-else-if="
              isPreviewableDocument &&
              isText(activeLightboxAttachment.source.mimeType)
            "
            class="cpk-attachment-queue-text-preview"
          >
            <div
              v-if="activeLightboxAttachment.filename"
              class="cpk-attachment-queue-text-preview-filename"
            >
              {{ activeLightboxAttachment.filename }}
            </div>
            <pre
              v-if="decodedTextPreview !== null"
              class="cpk-attachment-queue-text-preview-content"
              data-testid="copilot-chat-attachment-lightbox-document-text"
              >{{ decodedTextPreview }}</pre
            >
            <iframe
              v-else-if="lightboxDocumentSource"
              :src="lightboxDocumentSource"
              :title="activeLightboxAttachment.filename || 'Text preview'"
              class="cpk-attachment-queue-text-preview-frame"
              data-testid="copilot-chat-attachment-lightbox-document-iframe"
            />
          </div>

          <div
            v-else
            class="cpk-attachment-queue-document-card"
            data-testid="copilot-chat-attachment-lightbox-document-fallback"
          >
            <div class="cpk-attachment-queue-document-card-icon">
              {{
                getDocumentIcon(activeLightboxAttachment.source.mimeType ?? "")
              }}
            </div>
            <div class="cpk-attachment-queue-document-card-details">
              <div class="cpk-attachment-queue-document-card-name">
                {{ activeLightboxAttachment.filename || "Document" }}
              </div>
              <div class="cpk-attachment-queue-document-card-meta">
                {{ activeLightboxAttachment.source.mimeType || "Unknown type" }}
                {{
                  activeLightboxAttachment.size != null
                    ? ` · ${formatFileSize(activeLightboxAttachment.size)}`
                    : ""
                }}
              </div>
            </div>
            <div class="cpk-attachment-queue-document-card-note">
              No preview available for this file type
            </div>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>
