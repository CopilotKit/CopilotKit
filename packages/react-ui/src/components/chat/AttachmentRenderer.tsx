import React, { useState } from "react";
import type { InputContentSource } from "@copilotkit/shared";
import { getSourceUrl, getDocumentIcon } from "@copilotkit/shared";

interface AttachmentRendererProps {
  type: "image" | "audio" | "video" | "document";
  source: InputContentSource;
  content?: string;
  className?: string;
}

export const AttachmentRenderer: React.FC<AttachmentRendererProps> = ({
  type,
  source,
  content,
  className = "",
}) => {
  const src = getSourceUrl(source);

  switch (type) {
    case "image":
      return (
        <ImageAttachment src={src} content={content} className={className} />
      );
    case "audio":
      return (
        <div
          className={`copilotKitAttachment copilotKitAttachmentAudio ${className}`}
        >
          <audio src={src} controls preload="metadata" />
        </div>
      );
    case "video":
      return (
        <div
          className={`copilotKitAttachment copilotKitAttachmentVideo ${className}`}
        >
          <video src={src} controls preload="metadata" />
        </div>
      );
    case "document":
      return (
        <div
          className={`copilotKitAttachment copilotKitAttachmentDocument ${className}`}
        >
          <div className="copilotKitAttachmentDocIcon">
            {getDocumentIcon(source.mimeType ?? "")}
          </div>
          <div className="copilotKitAttachmentDocInfo">
            <span className="copilotKitAttachmentDocName">
              {content || "Document"}
            </span>
            <span className="copilotKitAttachmentDocMeta">
              {source.mimeType || "Unknown type"}
            </span>
          </div>
        </div>
      );
  }
};

function ImageAttachment({
  src,
  content,
  className,
}: {
  src: string;
  content?: string;
  className: string;
}) {
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div
        className={`copilotKitImageRendering copilotKitImageRenderingError ${className}`}
      >
        <div className="copilotKitImageRenderingErrorMessage">
          Failed to load image
        </div>
        {content && (
          <div className="copilotKitImageRenderingContent">{content}</div>
        )}
      </div>
    );
  }

  return (
    <div className={`copilotKitImageRendering ${className}`}>
      <img
        src={src}
        alt={content || "Image attachment"}
        className="copilotKitImageRenderingImage"
        onError={() => setError(true)}
      />
      {content && (
        <div className="copilotKitImageRenderingContent">{content}</div>
      )}
    </div>
  );
}
