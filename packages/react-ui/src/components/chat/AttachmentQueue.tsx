import React from "react";
import type { Attachment } from "./props";
import {
  formatFileSize,
  getSourceUrl,
  getDocumentIcon,
} from "@copilotkit/shared";

interface AttachmentQueueProps {
  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;
  className?: string;
}

export const AttachmentQueue: React.FC<AttachmentQueueProps> = ({
  attachments,
  onRemoveAttachment,
  className = "",
}) => {
  if (attachments.length === 0) return null;

  return (
    <div className={`copilotKitAttachmentQueue ${className}`}>
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className={`copilotKitAttachmentQueueItem copilotKitAttachmentQueueItem--${attachment.type}`}
        >
          {attachment.status === "uploading" && (
            <div className="copilotKitAttachmentQueueOverlay">
              <div className="copilotKitAttachmentQueueSpinner" />
            </div>
          )}
          <AttachmentPreview attachment={attachment} />
          <button
            onClick={() => onRemoveAttachment(attachment.id)}
            className="copilotKitAttachmentQueueRemoveButton"
            aria-label="Remove attachment"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
};

function AttachmentPreview({ attachment }: { attachment: Attachment }) {
  if (attachment.status === "uploading") {
    return <div className="copilotKitAttachmentQueuePreviewPlaceholder" />;
  }

  const src = getSourceUrl(attachment.source);

  switch (attachment.type) {
    case "image":
      return (
        <img
          src={src}
          alt={attachment.filename || "Image attachment"}
          className="copilotKitAttachmentQueuePreviewImage"
        />
      );

    case "audio":
      return (
        <div className="copilotKitAttachmentQueuePreviewAudio">
          <audio src={src} controls preload="metadata" />
          {attachment.filename && (
            <span className="copilotKitAttachmentQueueFilename">
              {attachment.filename}
            </span>
          )}
        </div>
      );

    case "video":
      return (
        <div className="copilotKitAttachmentQueuePreviewVideo">
          {attachment.thumbnail ? (
            <img
              src={attachment.thumbnail}
              alt={attachment.filename || "Video thumbnail"}
              className="copilotKitAttachmentQueuePreviewImage"
            />
          ) : (
            <video
              src={src}
              preload="metadata"
              muted
              className="copilotKitAttachmentQueuePreviewImage"
            />
          )}
        </div>
      );

    case "document":
      return (
        <div className="copilotKitAttachmentQueuePreviewDocument">
          <div className="copilotKitAttachmentQueueDocIcon">
            {getDocumentIcon(attachment.source.mimeType ?? "")}
          </div>
          <div className="copilotKitAttachmentQueueDocInfo">
            <span className="copilotKitAttachmentQueueFilename">
              {attachment.filename || "Document"}
            </span>
            {attachment.size != null && (
              <span className="copilotKitAttachmentQueueFileSize">
                {formatFileSize(attachment.size)}
              </span>
            )}
          </div>
        </div>
      );
  }
}

/**
 * @deprecated Use `AttachmentQueue` from `@copilotkit/react-ui` instead.
 * `ImageUploadQueue` only displayed image previews. `AttachmentQueue` supports
 * images, audio, video, and documents.
 * See https://docs.copilotkit.ai/migration-guides/migrate-attachments
 * @since 1.56.0
 */
export { AttachmentQueue as ImageUploadQueue };
