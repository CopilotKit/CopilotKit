import React, { memo, useState } from "react";
import type { InputContentSource } from "@copilotkit/shared";
import { getSourceUrl, getDocumentIcon } from "@copilotkit/shared";
import { cn } from "../../lib/utils";
import { Lightbox, useLightbox } from "./Lightbox";

interface CopilotChatAttachmentRendererProps {
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
  const { thumbnailRef, vtName, open, openLightbox, closeLightbox } =
    useLightbox();

  if (error) {
    return (
      <div
        className={cn(
          "cpk:flex cpk:flex-col cpk:items-center cpk:justify-center cpk:rounded-xl cpk:bg-muted cpk:p-4 cpk:text-sm cpk:text-muted-foreground",
          className,
        )}
      >
        <span>Failed to load image</span>
      </div>
    );
  }

  return (
    <>
      <img
        ref={thumbnailRef as React.Ref<HTMLImageElement>}
        src={src}
        alt="Image attachment"
        className={cn(
          "cpk:max-w-[80px] cpk:max-h-[80px] cpk:w-auto cpk:h-auto cpk:rounded-xl cpk:object-cover cpk:cursor-pointer cpk:bg-muted",
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
            alt="Image attachment"
            className="cpk:max-w-[90vw] cpk:max-h-[90vh] cpk:object-contain cpk:rounded-lg"
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
    <div className={cn("cpk:flex cpk:flex-col cpk:gap-1", className)}>
      <audio
        src={src}
        controls
        preload="metadata"
        className="cpk:max-w-[300px] cpk:w-full cpk:h-10"
      />
      {filename && (
        <span className="cpk:text-xs cpk:text-muted-foreground cpk:truncate cpk:max-w-[300px]">
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
      className={cn("cpk:max-w-[400px] cpk:w-full cpk:rounded-lg", className)}
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
        "cpk:inline-flex cpk:max-w-full cpk:items-center cpk:gap-2.5 cpk:py-2 cpk:pl-2 cpk:pr-3 cpk:border cpk:border-border cpk:rounded-xl cpk:bg-card cpk:no-underline cpk:transition-colors cpk:hover:bg-accent",
        className,
      )}
    >
      <span className="cpk:flex cpk:size-8 cpk:shrink-0 cpk:items-center cpk:justify-center cpk:rounded-lg cpk:bg-primary/10 cpk:text-[10px] cpk:font-semibold cpk:uppercase cpk:text-primary">
        {getDocumentIcon(source.mimeType ?? "")}
      </span>
      <span className="cpk:text-sm cpk:text-foreground cpk:truncate">
        {filename || source.mimeType || "Unknown type"}
      </span>
    </a>
  );
});

export const CopilotChatAttachmentRenderer: React.FC<
  CopilotChatAttachmentRendererProps
> = ({ type, source, filename, className }) => {
  const src = getSourceUrl(source);

  let attachment: React.ReactNode;
  switch (type) {
    case "image":
      attachment = <ImageAttachment src={src} className={className} />;
      break;
    case "audio":
      attachment = (
        <AudioAttachment src={src} filename={filename} className={className} />
      );
      break;
    case "video":
      attachment = <VideoAttachment src={src} className={className} />;
      break;
    case "document":
      attachment = (
        <DocumentAttachment
          src={src}
          source={source}
          filename={filename}
          className={className}
        />
      );
      break;
  }

  // Scope tokens and preflight for standalone use; `contents` adds no box.
  return (
    <div data-copilotkit style={{ display: "contents" }}>
      {attachment}
    </div>
  );
};

export default CopilotChatAttachmentRenderer;
