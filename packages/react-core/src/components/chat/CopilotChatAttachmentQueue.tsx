import React, { useEffect, useState } from "react";
import type { Attachment } from "@copilotkit/shared";
import {
  formatFileSize,
  getSourceUrl,
  getDocumentIcon,
} from "@copilotkit/shared";
import { CopilotIcon } from "../icons/CopilotIcon";
import { cn } from "../../lib/utils";
import { Lightbox, useLightbox } from "./Lightbox";
import {
  CopilotChatDefaultLabels,
  ɵcanPreviewDocument,
  ɵcreateObjectUrlFromSource,
  ɵdecodeTextSource,
} from "@copilotkit/core";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";

interface CopilotChatAttachmentQueueProps {
  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;
  className?: string;
}

/**
 * The attachments queued in the composer, each with a preview and a remove
 * button named by `labels.attachmentRemoveButtonLabel`.
 */
export const CopilotChatAttachmentQueue: React.FC<
  CopilotChatAttachmentQueueProps
> = ({ attachments, onRemoveAttachment, className }) => {
  const config = useCopilotChatConfiguration();
  const labels = config?.labels ?? CopilotChatDefaultLabels;
  if (attachments.length === 0) return null;

  return (
    <div
      data-testid="copilot-attachment-queue"
      className={cn("cpk-attachment-queue", className)}
    >
      {attachments.map((attachment) => {
        const isMedia =
          attachment.type === "image" || attachment.type === "video";
        return (
          <div
            key={attachment.id}
            className={cn(
              "cpk-attachment-queue-item",
              isMedia
                ? "cpk-attachment-queue-item-media"
                : attachment.type === "audio"
                  ? "cpk-attachment-queue-item-audio"
                  : "cpk-attachment-queue-item-document",
            )}
          >
            {attachment.status === "uploading" && <UploadingOverlay />}
            <AttachmentPreview attachment={attachment} />
            <button
              onClick={() => onRemoveAttachment(attachment.id)}
              className="cpk-attachment-queue-remove-button"
              aria-label={labels.attachmentRemoveButtonLabel}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function UploadingOverlay() {
  return (
    <div className="cpk-attachment-queue-uploading-overlay">
      <div className="cpk-attachment-queue-uploading-spinner" />
    </div>
  );
}

function AttachmentPreview({ attachment }: { attachment: Attachment }) {
  if (attachment.status === "uploading") {
    return <div className="cpk-attachment-queue-placeholder" />;
  }

  switch (attachment.type) {
    case "image":
      return <ImagePreview attachment={attachment} />;
    case "audio":
      return <AudioPreview attachment={attachment} />;
    case "video":
      return <VideoPreview attachment={attachment} />;
    case "document":
      return <DocumentPreview attachment={attachment} />;
  }
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

function ImagePreview({ attachment }: { attachment: Attachment }) {
  const src = getSourceUrl(attachment.source);
  const { thumbnailRef, vtName, open, openLightbox, closeLightbox } =
    useLightbox();

  return (
    <>
      <img
        ref={thumbnailRef as React.Ref<HTMLImageElement>}
        src={src}
        alt={attachment.filename || "Image attachment"}
        className="cpk-attachment-queue-image"
        onClick={openLightbox}
      />
      {open && (
        <Lightbox
          onClose={closeLightbox}
          label={attachment.filename || "Image attachment"}
        >
          <img
            style={{ viewTransitionName: vtName }}
            src={src}
            alt={attachment.filename || "Image attachment"}
            className="cpk-attachment-queue-lightbox-image"
          />
        </Lightbox>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

function AudioPreview({ attachment }: { attachment: Attachment }) {
  const src = getSourceUrl(attachment.source);
  return (
    <div className="cpk-attachment-queue-audio">
      <audio
        src={src}
        controls
        preload="metadata"
        className="cpk-attachment-queue-audio-player"
      />
      {attachment.filename && (
        <span className="cpk-attachment-queue-audio-filename">
          {attachment.filename}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Video – thumbnail with play button; click opens lightbox with full controls
// ---------------------------------------------------------------------------

/**
 * A video thumbnail with a play button, named by
 * `labels.attachmentPlayVideoButtonLabel`, that opens the full player in a
 * lightbox.
 */
function VideoPreview({ attachment }: { attachment: Attachment }) {
  const config = useCopilotChatConfiguration();
  const labels = config?.labels ?? CopilotChatDefaultLabels;
  const src = getSourceUrl(attachment.source);
  const { thumbnailRef, vtName, open, openLightbox, closeLightbox } =
    useLightbox();

  return (
    <>
      <div
        ref={thumbnailRef as React.Ref<HTMLDivElement>}
        className="cpk-attachment-queue-video"
      >
        {attachment.thumbnail ? (
          <img
            src={attachment.thumbnail}
            alt={attachment.filename || "Video thumbnail"}
            className="cpk-attachment-queue-video-thumbnail"
          />
        ) : (
          <video
            src={src}
            preload="metadata"
            muted
            className="cpk-attachment-queue-video-thumbnail"
          />
        )}
      </div>
      <button
        onClick={openLightbox}
        className="cpk-attachment-queue-video-play-button"
        aria-label={labels.attachmentPlayVideoButtonLabel}
      >
        <div className="cpk-attachment-queue-video-play-badge">
          <CopilotIcon
            name="Play"
            className="cpk-attachment-queue-video-play-icon"
          />
        </div>
      </button>
      {open && (
        <Lightbox
          onClose={closeLightbox}
          label={attachment.filename || "Video attachment"}
        >
          <video
            style={{ viewTransitionName: vtName }}
            src={src}
            controls
            autoPlay
            className="cpk-attachment-queue-lightbox-video"
          />
        </Lightbox>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Document – click opens lightbox with PDF/text preview or info card
// ---------------------------------------------------------------------------

/**
 * A URL a frame can show for the attachment. Base64 data becomes a blob:
 * URL (browsers block data: URLs for PDFs), revoked on unmount.
 */
function useBlobUrl(attachment: Attachment): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (attachment.source.type !== "data") return;
    const objectUrl = ɵcreateObjectUrlFromSource(attachment.source);
    setUrl(objectUrl?.url ?? null);
    return objectUrl?.revoke;
  }, [
    attachment.source.type,
    attachment.source.value,
    attachment.source.mimeType,
  ]);

  if (attachment.source.type === "url") return attachment.source.value;
  return url;
}

function DocumentLightboxContent({
  attachment,
  vtName,
}: {
  attachment: Attachment;
  vtName: string;
}) {
  const config = useCopilotChatConfiguration();
  const labels = config?.labels ?? CopilotChatDefaultLabels;
  const mimeType = attachment.source.mimeType;
  const blobUrl = useBlobUrl(attachment);
  const preview = ɵcanPreviewDocument(mimeType);

  if (preview === "pdf") {
    if (!blobUrl) return null;
    return (
      <iframe
        style={{ viewTransitionName: vtName }}
        src={blobUrl}
        title={attachment.filename || "PDF preview"}
        className="cpk-attachment-queue-pdf-preview"
      />
    );
  }

  if (preview === "text") {
    const textContent = ɵdecodeTextSource(attachment.source);
    return (
      <div
        style={{ viewTransitionName: vtName }}
        className="cpk-attachment-queue-text-preview"
      >
        {attachment.filename && (
          <div className="cpk-attachment-queue-text-preview-filename">
            {attachment.filename}
          </div>
        )}
        {textContent ? (
          <pre className="cpk-attachment-queue-text-preview-content">
            {textContent}
          </pre>
        ) : blobUrl ? (
          <iframe
            src={blobUrl}
            title={attachment.filename || "Text preview"}
            className="cpk-attachment-queue-text-preview-frame"
          />
        ) : null}
      </div>
    );
  }

  // Fallback: info card for non-previewable documents
  return (
    <div
      style={{ viewTransitionName: vtName }}
      className="cpk-attachment-queue-document-card"
    >
      <div className="cpk-attachment-queue-document-card-icon">
        {getDocumentIcon(mimeType ?? "")}
      </div>
      <div className="cpk-attachment-queue-document-card-details">
        <div className="cpk-attachment-queue-document-card-name">
          {attachment.filename || labels.attachmentDocumentLabel}
        </div>
        <div className="cpk-attachment-queue-document-card-meta">
          {mimeType || labels.attachmentUnknownTypeText}
          {attachment.size != null && ` · ${formatFileSize(attachment.size)}`}
        </div>
      </div>
      <div className="cpk-attachment-queue-document-card-note">
        {labels.attachmentNoPreviewText}
      </div>
    </div>
  );
}

function DocumentPreview({ attachment }: { attachment: Attachment }) {
  const config = useCopilotChatConfiguration();
  const labels = config?.labels ?? CopilotChatDefaultLabels;
  const { thumbnailRef, vtName, open, openLightbox, closeLightbox } =
    useLightbox();

  const mimeType = attachment.source.mimeType;
  const previewable = ɵcanPreviewDocument(mimeType) !== null;

  return (
    <>
      <div
        ref={thumbnailRef as React.Ref<HTMLDivElement>}
        className={cn(
          "cpk-attachment-queue-document",
          previewable && "cpk-attachment-queue-document-previewable",
        )}
        onClick={previewable ? openLightbox : undefined}
      >
        <div className="cpk-attachment-queue-document-icon">
          {getDocumentIcon(mimeType ?? "")}
        </div>
        <div className="cpk-attachment-queue-document-info">
          <span className="cpk-attachment-queue-document-name">
            {attachment.filename || labels.attachmentDocumentLabel}
          </span>
          {attachment.size != null && (
            <span className="cpk-attachment-queue-document-size">
              {formatFileSize(attachment.size)}
            </span>
          )}
        </div>
      </div>
      {open && (
        <Lightbox
          onClose={closeLightbox}
          label={attachment.filename || labels.attachmentDocumentLabel}
        >
          <DocumentLightboxContent attachment={attachment} vtName={vtName} />
        </Lightbox>
      )}
    </>
  );
}
