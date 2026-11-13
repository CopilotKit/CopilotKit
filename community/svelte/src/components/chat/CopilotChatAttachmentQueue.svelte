<script lang="ts">
  import { formatFileSize, getDocumentIcon, getSourceUrl } from "@copilotkit/shared";
  import type { Attachment } from "@copilotkit/shared";

  let {
    attachments = [] as Attachment[],
    onRemoveAttachment,
  }: {
    attachments?: Attachment[];
    onRemoveAttachment?: (id: string) => void;
  } = $props();
</script>

{#if attachments.length > 0}
  <div data-testid="copilot-attachment-queue" class="copilotkit-attachment-queue">
    {#each attachments as attachment (attachment.id)}
      <div
        data-testid="copilot-chat-attachment-item"
        data-card-type={attachment.type}
        class="copilotkit-attachment-card"
        class:is-media={attachment.type === "image" || attachment.type === "video"}
      >
        {#if attachment.status === "uploading"}
          <div
            data-testid="copilot-chat-attachment-uploading-overlay"
            class="copilotkit-attachment-uploading"
            aria-label="Uploading"
          >
            <div class="copilotkit-attachment-spinner"></div>
          </div>
        {/if}
        {#if attachment.status === "ready"}
          {#if attachment.type === "image"}
            <img
              src={getSourceUrl(attachment.source)}
              alt={attachment.filename || "Image attachment"}
              class="copilotkit-attachment-image"
              data-testid="copilot-chat-attachment-image-thumbnail"
            />
          {:else if attachment.type === "video"}
            {#if attachment.thumbnail}
              <img
                src={attachment.thumbnail}
                alt={attachment.filename || "Video thumbnail"}
                class="copilotkit-attachment-image"
                data-testid="copilot-chat-attachment-video-thumbnail"
              />
            {:else}
              <video
                src={getSourceUrl(attachment.source)}
                preload="metadata"
                muted
                class="copilotkit-attachment-image"
                data-testid="copilot-chat-attachment-video-fallback"
              ></video>
            {/if}
          {:else if attachment.type === "audio"}
            <div class="copilotkit-attachment-audio">
              <audio
                src={getSourceUrl(attachment.source)}
                controls
                preload="metadata"
                class="copilotkit-attachment-audio-player"
                data-testid="copilot-chat-attachment-audio-player"
              ></audio>
              {#if attachment.filename}
                <span class="copilotkit-attachment-name">{attachment.filename}</span>
              {/if}
            </div>
          {:else}
            <div class="copilotkit-attachment-doc">
              <div class="copilotkit-attachment-doc-icon">
                {getDocumentIcon(attachment.source.mimeType ?? "")}
              </div>
              <div class="copilotkit-attachment-doc-meta">
                <span
                  class="copilotkit-attachment-name"
                  data-testid="copilot-chat-attachment-document-filename"
                >
                  {attachment.filename || "Document"}
                </span>
                {#if attachment.size != null}
                  <span class="copilotkit-attachment-size">
                    {formatFileSize(attachment.size)}
                  </span>
                {/if}
              </div>
            </div>
          {/if}
        {:else}
          <div
            class="copilotkit-attachment-placeholder"
            data-testid="copilot-chat-attachment-placeholder"
          ></div>
        {/if}
        <button
          type="button"
          class="copilotkit-attachment-remove"
          aria-label="Remove attachment"
          onclick={() => onRemoveAttachment?.(attachment.id)}
        >
          ✕
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .copilotkit-attachment-queue {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px;
  }

  .copilotkit-attachment-card {
    position: relative;
    display: inline-flex;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid #e5e7eb;
    background: #fff;
    padding: 8px 28px 8px 12px;
    max-width: 240px;
  }

  .copilotkit-attachment-card.is-media {
    width: 72px;
    height: 72px;
    padding: 0 0 0 0;
  }

  .copilotkit-attachment-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .copilotkit-attachment-uploading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.4);
    z-index: 10;
  }

  .copilotkit-attachment-spinner {
    width: 20px;
    height: 20px;
    border: 2px solid #fff;
    border-top-color: transparent;
    border-radius: 9999px;
    animation: copilotkit-spin 0.8s linear infinite;
  }

  @keyframes copilotkit-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .copilotkit-attachment-audio {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    min-width: 200px;
    max-width: 280px;
  }

  .copilotkit-attachment-audio-player {
    width: 100%;
    height: 32px;
  }

  .copilotkit-attachment-doc {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .copilotkit-attachment-doc-icon {
    width: 32px;
    height: 32px;
    border-radius: 6px;
    background: #3b82f6;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .copilotkit-attachment-doc-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .copilotkit-attachment-name {
    font-size: 12px;
    font-weight: 500;
    word-break: break-all;
    line-height: 1.25;
  }

  .copilotkit-attachment-size {
    font-size: 11px;
    color: #6b7280;
  }

  .copilotkit-attachment-placeholder {
    width: 100%;
    height: 100%;
    min-height: 40px;
    background: rgba(107, 114, 128, 0.2);
  }

  .copilotkit-attachment-remove {
    position: absolute;
    top: 4px;
    right: 4px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    border: none;
    border-radius: 9999px;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 10px;
    z-index: 20;
  }
</style>
