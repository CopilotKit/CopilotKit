import React from "react";
import type { Attachment } from "./props";
import { formatFileSize } from "./attachment-utils";

interface AttachmentQueueProps {
  attachments: Attachment[];
  onRemoveAttachment: (index: number) => void;
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
      {attachments.map((attachment, index) => (
        <div
          key={index}
          className={`copilotKitAttachmentQueueItem copilotKitAttachmentQueueItem--${attachment.type}`}
        >
          {attachment.status === "uploading" && (
            <div className="copilotKitAttachmentQueueOverlay">
              <div className="copilotKitAttachmentQueueSpinner" />
            </div>
          )}
          <AttachmentPreview attachment={attachment} />
          <button
            onClick={() => onRemoveAttachment(index)}
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
  const src = getSourceUrl(attachment);

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
            <video src={src} preload="metadata" muted className="copilotKitAttachmentQueuePreviewImage" />
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

function getSourceUrl(attachment: Attachment): string {
  if (attachment.source.type === "url") {
    return attachment.source.value;
  }
  const mimeType = attachment.source.mimeType;
  return `data:${mimeType};base64,${attachment.source.value}`;
}

function getDocumentIcon(mimeType: string): string {
  if (mimeType.includes("pdf")) return "PDF";
  if (mimeType.includes("word") || mimeType.includes("document")) return "DOC";
  if (mimeType.includes("sheet") || mimeType.includes("excel")) return "XLS";
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) return "PPT";
  if (mimeType.includes("text/")) return "TXT";
  return "FILE";
}

/**
 * @deprecated Use `AttachmentQueue` from `@copilotkit/react-ui` instead.
 * `ImageUploadQueue` only displayed image previews. `AttachmentQueue` supports
 * images, audio, video, and documents.
 * See https://docs.copilotkit.ai/troubleshooting/migrate-attachments
 * Since v1.x.0
 */
export { AttachmentQueue as ImageUploadQueue };
