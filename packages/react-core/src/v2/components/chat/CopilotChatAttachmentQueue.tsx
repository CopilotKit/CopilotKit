import React, { useEffect, useRef, useState } from "react";
import type { Attachment } from "@copilotkit/shared";
import {
  formatFileSize,
  getSourceUrl,
  getDocumentIcon,
} from "@copilotkit/shared";
import { Pause, Play, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { Lightbox, useLightbox } from "./Lightbox";

interface CopilotChatAttachmentQueueProps {
  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;
  className?: string;
}

export const CopilotChatAttachmentQueue: React.FC<
  CopilotChatAttachmentQueueProps
> = ({ attachments, onRemoveAttachment, className }) => {
  if (attachments.length === 0) return null;

  return (
    <div
      data-copilotkit
      data-testid="copilot-attachment-queue"
      className={cn(
        "cpk:flex cpk:flex-wrap cpk:gap-2 cpk:bg-transparent cpk:p-2",
        className,
      )}
    >
      {attachments.map((attachment) => {
        const isMedia =
          attachment.type === "image" || attachment.type === "video";
        return (
          <div
            key={attachment.id}
            className={cn(
              "cpk:relative cpk:inline-flex cpk:rounded-xl cpk:overflow-hidden cpk:border cpk:border-border cpk:bg-card",
              isMedia
                ? "cpk:w-[72px] cpk:h-[72px]"
                : "cpk:p-2 cpk:px-3 cpk:pr-8 cpk:max-w-[240px]",
            )}
          >
            {attachment.status === "uploading" && <UploadingOverlay />}
            <AttachmentPreview attachment={attachment} />
            <button
              onClick={() => onRemoveAttachment(attachment.id)}
              className={cn(
                "cpk:absolute cpk:bg-foreground/80 cpk:text-background cpk:hover:bg-foreground cpk:border-none cpk:rounded-full cpk:size-5 cpk:flex cpk:items-center cpk:justify-center cpk:cursor-pointer cpk:z-20 cpk:shadow-sm cpk:transition-colors",
                isMedia ? "cpk:top-1 cpk:right-1" : "cpk:top-1.5 cpk:right-1.5",
              )}
              aria-label="Remove attachment"
            >
              <X className="cpk:size-3" strokeWidth={2.5} aria-hidden="true" />
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
    <div className="cpk:absolute cpk:inset-0 cpk:flex cpk:items-center cpk:justify-center cpk:bg-background/60 cpk:z-10">
      <div className="cpk:size-5 cpk:border-2 cpk:border-foreground/70 cpk:border-t-transparent cpk:rounded-full cpk:animate-spin" />
    </div>
  );
}

function AttachmentPreview({ attachment }: { attachment: Attachment }) {
  // Keep the preview (and its filename) visible under the uploading overlay;
  // only fall back to an empty tile while there is nothing to show yet.
  if (attachment.status === "uploading" && !attachment.source.value) {
    return <div className="cpk:w-full cpk:h-full" />;
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
        className="cpk:w-full cpk:h-full cpk:object-cover cpk:cursor-pointer"
        onClick={openLightbox}
      />
      {open && (
        <Lightbox onClose={closeLightbox}>
          <img
            style={{ viewTransitionName: vtName }}
            src={src}
            alt={attachment.filename || "Image attachment"}
            className="cpk:max-w-[90vw] cpk:max-h-[90vh] cpk:object-contain cpk:rounded-lg"
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
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };

  // The duration once the metadata loads; the file size until then.
  let meta: string | null = null;
  if (duration != null) {
    meta = formatDuration(duration);
  } else if (attachment.size != null) {
    meta = formatFileSize(attachment.size);
  }

  return (
    <div className="cpk:flex cpk:items-center cpk:gap-2">
      <button
        type="button"
        onClick={togglePlayback}
        aria-label={playing ? "Pause audio" : "Play audio"}
        className="cpk:flex cpk:size-8 cpk:shrink-0 cpk:items-center cpk:justify-center cpk:rounded-lg cpk:border-none cpk:bg-primary/10 cpk:text-primary cpk:cursor-pointer cpk:transition-colors cpk:hover:bg-primary/15"
      >
        {playing ? (
          <Pause className="cpk:size-3.5 cpk:fill-current" aria-hidden="true" />
        ) : (
          <Play
            className="cpk:size-3.5 cpk:fill-current cpk:ml-px"
            aria-hidden="true"
          />
        )}
      </button>
      <div className="cpk:flex cpk:flex-col cpk:min-w-0">
        <span className="cpk:text-xs cpk:font-medium cpk:truncate cpk:leading-tight cpk:text-foreground">
          {attachment.filename || "Audio"}
        </span>
        {meta && (
          <span className="cpk:text-[11px] cpk:tabular-nums cpk:text-muted-foreground">
            {meta}
          </span>
        )}
      </div>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        className="cpk:hidden"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(event) => {
          const seconds = event.currentTarget.duration;
          if (Number.isFinite(seconds)) setDuration(seconds);
        }}
      />
    </div>
  );
}

function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Video – thumbnail with play button; click opens lightbox with full controls
// ---------------------------------------------------------------------------

function VideoPreview({ attachment }: { attachment: Attachment }) {
  const src = getSourceUrl(attachment.source);
  const { thumbnailRef, vtName, open, openLightbox, closeLightbox } =
    useLightbox();

  return (
    <>
      <div
        ref={thumbnailRef as React.Ref<HTMLDivElement>}
        className="cpk:w-full cpk:h-full"
      >
        {attachment.thumbnail ? (
          <img
            src={attachment.thumbnail}
            alt={attachment.filename || "Video thumbnail"}
            className="cpk:w-full cpk:h-full cpk:object-cover"
          />
        ) : (
          <video
            src={src}
            preload="metadata"
            muted
            className="cpk:w-full cpk:h-full cpk:object-cover"
          />
        )}
      </div>
      <button
        onClick={openLightbox}
        className="cpk:absolute cpk:inset-0 cpk:flex cpk:items-center cpk:justify-center cpk:z-10 cpk:cursor-pointer cpk:bg-black/20 cpk:border-none cpk:p-0"
        aria-label="Play video"
      >
        <div className="cpk:w-8 cpk:h-8 cpk:rounded-full cpk:bg-black/60 cpk:flex cpk:items-center cpk:justify-center">
          <Play className="cpk:w-4 cpk:h-4 cpk:text-white cpk:ml-0.5" />
        </div>
      </button>
      {open && (
        <Lightbox onClose={closeLightbox}>
          <video
            style={{ viewTransitionName: vtName }}
            src={src}
            controls
            autoPlay
            className="cpk:max-w-[90vw] cpk:max-h-[90vh] cpk:rounded-lg"
          />
        </Lightbox>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Document – click opens lightbox with PDF/text preview or info card
// ---------------------------------------------------------------------------

function isPdf(mimeType: string | undefined): boolean {
  return !!mimeType && mimeType.includes("pdf");
}

function isText(mimeType: string | undefined): boolean {
  return !!mimeType && mimeType.startsWith("text/");
}

function canPreviewInBrowser(mimeType: string | undefined): boolean {
  return isPdf(mimeType) || isText(mimeType);
}

/**
 * Convert a base64-encoded data source to a blob: URL that browsers will
 * render inside an iframe (data: URLs are blocked for PDFs in most browsers).
 */
function useBlobUrl(attachment: Attachment): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (attachment.source.type !== "data") return;
    try {
      const binary = atob(attachment.source.value);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], {
        type: attachment.source.mimeType || "application/octet-stream",
      });
      const blobUrl = URL.createObjectURL(blob);
      setUrl(blobUrl);
      return () => URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("[CopilotKit] Failed to decode attachment data:", error);
      setUrl(null);
    }
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
  const mimeType = attachment.source.mimeType;
  const blobUrl = useBlobUrl(attachment);

  if (isPdf(mimeType)) {
    if (!blobUrl) return null;
    return (
      <iframe
        style={{ viewTransitionName: vtName }}
        src={blobUrl}
        title={attachment.filename || "PDF preview"}
        className="cpk:w-[90vw] cpk:h-[90vh] cpk:max-w-[1000px] cpk:rounded-xl cpk:bg-white"
      />
    );
  }

  if (isText(mimeType)) {
    // Decode base64 text content for display
    const textContent =
      attachment.source.type === "data"
        ? (() => {
            try {
              return atob(attachment.source.value);
            } catch {
              return attachment.source.value;
            }
          })()
        : null;

    return (
      <div
        style={{ viewTransitionName: vtName }}
        className="cpk:w-[90vw] cpk:max-w-[800px] cpk:max-h-[90vh] cpk:overflow-auto cpk:rounded-xl cpk:bg-background cpk:text-foreground cpk:p-6"
      >
        {attachment.filename && (
          <div className="cpk:text-sm cpk:font-medium cpk:text-muted-foreground cpk:mb-4 cpk:pb-2 cpk:border-b cpk:border-border">
            {attachment.filename}
          </div>
        )}
        {textContent ? (
          <pre className="cpk:text-sm cpk:whitespace-pre-wrap cpk:break-words cpk:text-foreground cpk:font-mono cpk:m-0">
            {textContent}
          </pre>
        ) : blobUrl ? (
          <iframe
            src={blobUrl}
            title={attachment.filename || "Text preview"}
            className="cpk:w-full cpk:h-[80vh] cpk:border-none"
          />
        ) : null}
      </div>
    );
  }

  // Fallback: info card for non-previewable documents
  return (
    <div
      style={{ viewTransitionName: vtName }}
      className="cpk:flex cpk:flex-col cpk:items-center cpk:gap-4 cpk:p-8 cpk:rounded-xl cpk:bg-background cpk:text-foreground"
    >
      <div className="cpk:size-16 cpk:rounded-2xl cpk:bg-primary/10 cpk:text-primary cpk:flex cpk:items-center cpk:justify-center cpk:text-lg cpk:font-semibold">
        {getDocumentIcon(mimeType ?? "")}
      </div>
      <div className="cpk:text-center">
        <div className="cpk:text-base cpk:font-medium cpk:text-foreground">
          {attachment.filename || "Document"}
        </div>
        <div className="cpk:text-sm cpk:text-muted-foreground cpk:mt-1">
          {mimeType || "Unknown type"}
          {attachment.size != null && ` · ${formatFileSize(attachment.size)}`}
        </div>
      </div>
      <div className="cpk:text-xs cpk:text-muted-foreground">
        No preview available for this file type
      </div>
    </div>
  );
}

function DocumentPreview({ attachment }: { attachment: Attachment }) {
  const { thumbnailRef, vtName, open, openLightbox, closeLightbox } =
    useLightbox();

  const mimeType = attachment.source.mimeType;
  const previewable = canPreviewInBrowser(mimeType);

  return (
    <>
      <div
        ref={thumbnailRef as React.Ref<HTMLDivElement>}
        className={cn(
          "cpk:flex cpk:items-center cpk:gap-2",
          previewable && "cpk:cursor-pointer",
        )}
        onClick={previewable ? openLightbox : undefined}
      >
        <div className="cpk:size-8 cpk:rounded-lg cpk:bg-primary/10 cpk:text-primary cpk:flex cpk:items-center cpk:justify-center cpk:text-[10px] cpk:font-semibold cpk:shrink-0">
          {getDocumentIcon(mimeType ?? "")}
        </div>
        <div className="cpk:flex cpk:flex-col cpk:min-w-0">
          <span className="cpk:text-xs cpk:font-medium cpk:break-all cpk:leading-tight cpk:text-foreground">
            {attachment.filename || "Document"}
          </span>
          {attachment.size != null && (
            <span className="cpk:text-[11px] cpk:text-muted-foreground">
              {formatFileSize(attachment.size)}
            </span>
          )}
        </div>
      </div>
      {open && (
        <Lightbox onClose={closeLightbox}>
          <DocumentLightboxContent attachment={attachment} vtName={vtName} />
        </Lightbox>
      )}
    </>
  );
}
