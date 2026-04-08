import React, { memo, useState } from "react";
import type { InputContentSource } from "@copilotkit/shared";
import { getSourceUrl, getDocumentIcon } from "@copilotkit/shared";

interface AttachmentRendererProps {
  type: "image" | "audio" | "video" | "document";
  source: InputContentSource;
  filename?: string;
  className?: string;
}

const ImageAttachment = memo(function ImageAttachment({
  src,
  className,
}: {
  src: string;
  className?: string;
}) {
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div
        className={`copilotKitImageRendering copilotKitImageRenderingError ${className ?? ""}`}
      >
        <div className="copilotKitImageRenderingErrorMessage">
          Failed to load image
        </div>
      </div>
    );
  }

  return (
    <div className={`copilotKitImageRendering ${className ?? ""}`}>
      <img
        src={src}
        alt="Image attachment"
        className="copilotKitImageRenderingImage"
        onError={() => setError(true)}
      />
    </div>
  );
});

const AudioAttachment = memo(function AudioAttachment({
  src,
  filename,
  className,
}: {
  src: string;
  filename?: string;
  className?: string;
}) {
  return (
    <div
      className={`copilotKitAttachment copilotKitAttachmentAudio ${className ?? ""}`}
    >
      <audio src={src} controls preload="metadata" />
      {filename && (
        <span className="copilotKitAttachmentFilename">{filename}</span>
      )}
    </div>
  );
});

const VideoAttachment = memo(function VideoAttachment({
  src,
  className,
}: {
  src: string;
  className?: string;
}) {
  return (
    <div
      className={`copilotKitAttachment copilotKitAttachmentVideo ${className ?? ""}`}
    >
      <video src={src} controls preload="metadata" />
    </div>
  );
});

const DocumentAttachment = memo(function DocumentAttachment({
  source,
  filename,
  className,
}: {
  source: InputContentSource;
  filename?: string;
  className?: string;
}) {
  return (
    <div
      className={`copilotKitAttachment copilotKitAttachmentDocument ${className ?? ""}`}
    >
      <div className="copilotKitAttachmentDocIcon">
        {getDocumentIcon(source.mimeType ?? "")}
      </div>
      <div className="copilotKitAttachmentDocInfo">
        <span className="copilotKitAttachmentDocName">
          {filename || source.mimeType || "Unknown type"}
        </span>
      </div>
    </div>
  );
});

export const AttachmentRenderer: React.FC<AttachmentRendererProps> = ({
  type,
  source,
  filename,
  className,
}) => {
  const src = getSourceUrl(source);

  switch (type) {
    case "image":
      return <ImageAttachment src={src} className={className} />;
    case "audio":
      return (
        <AudioAttachment src={src} filename={filename} className={className} />
      );
    case "video":
      return <VideoAttachment src={src} className={className} />;
    case "document":
      return (
        <DocumentAttachment
          source={source}
          filename={filename}
          className={className}
        />
      );
  }
};
