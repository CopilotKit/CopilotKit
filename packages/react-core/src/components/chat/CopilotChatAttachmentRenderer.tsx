import React, { memo, useState } from "react";
import type { InputContentSource } from "@copilotkit/shared";
import { getSourceUrl, getDocumentIcon } from "@copilotkit/shared";
import { CopilotChatDefaultLabels } from "@copilotkit/core";
import { cn } from "../../lib/utils";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";
import { Lightbox, useLightbox } from "./Lightbox";

interface CopilotChatAttachmentRendererProps {
  type: "image" | "audio" | "video" | "document";
  source: InputContentSource;
  filename?: string;
  className?: string;
}

/** The chat labels from the nearest chat configuration, or the defaults. */
function useLabels() {
  const config = useCopilotChatConfiguration();
  return config?.labels ?? CopilotChatDefaultLabels;
}

const ImageAttachment = memo(function ImageAttachment({
  src,
  className,
}: {
  src: string;
  className?: string;
}) {
  const labels = useLabels();
  const [error, setError] = useState(false);
  const { thumbnailRef, vtName, open, openLightbox, closeLightbox } =
    useLightbox();

  if (error) {
    return (
      <div
        className={cn(
          "cpk-attachment-renderer cpk-attachment-renderer-image-error",
          className,
        )}
      >
        <span>{labels.attachmentImageLoadErrorText}</span>
      </div>
    );
  }

  return (
    <>
      <img
        ref={thumbnailRef as React.Ref<HTMLImageElement>}
        src={src}
        alt={labels.attachmentImageAltText}
        className={cn(
          "cpk-attachment-renderer cpk-attachment-renderer-image",
          className,
        )}
        onClick={openLightbox}
        onError={() => setError(true)}
      />
      {open && (
        <Lightbox onClose={closeLightbox}>
          <img
            style={{ viewTransitionName: vtName }}
            src={src}
            alt={labels.attachmentImageAltText}
            className="cpk-attachment-renderer-lightbox-image"
          />
        </Lightbox>
      )}
    </>
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
      className={cn(
        "cpk-attachment-renderer cpk-attachment-renderer-audio",
        className,
      )}
    >
      <audio
        src={src}
        controls
        preload="metadata"
        className="cpk-attachment-renderer-audio-player"
      />
      {filename && (
        <span className="cpk-attachment-renderer-audio-filename">
          {filename}
        </span>
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
    <video
      src={src}
      controls
      preload="metadata"
      className={cn(
        "cpk-attachment-renderer cpk-attachment-renderer-video",
        className,
      )}
    />
  );
});

const DocumentAttachment = memo(function DocumentAttachment({
  src,
  source,
  filename,
  className,
}: {
  src: string;
  source: InputContentSource;
  filename?: string;
  className?: string;
}) {
  const labels = useLabels();
  const label = filename || source.mimeType || "Document attachment";

  // `download` is honoured for same-origin, data: and blob: URLs. Browsers
  // ignore it for cross-origin URLs unless the server sends
  // `Content-Disposition: attachment`; `target="_blank"` keeps those from
  // navigating the chat away and lets the file open in a new tab instead.
  return (
    <a
      href={src}
      download={filename ?? ""}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className={cn(
        "cpk-attachment-renderer cpk-attachment-renderer-document",
        className,
      )}
    >
      <span className="cpk-attachment-renderer-document-icon">
        {getDocumentIcon(source.mimeType ?? "")}
      </span>
      <span className="cpk-attachment-renderer-document-name">
        {filename || source.mimeType || labels.attachmentUnknownTypeText}
      </span>
    </a>
  );
});

export const CopilotChatAttachmentRenderer: React.FC<
  CopilotChatAttachmentRendererProps
> = ({ type, source, filename, className }) => {
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
          src={src}
          source={source}
          filename={filename}
          className={className}
        />
      );
  }
};

export default CopilotChatAttachmentRenderer;
