import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import type { Attachment } from "@copilotkit/shared";
import {
  formatFileSize,
  getSourceUrl,
  getDocumentIcon,
} from "@copilotkit/shared";
import { Play, X } from "lucide-react";
import { cn } from "../../lib/utils";

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
      data-testid="copilot-attachment-queue"
      className={cn("cpk:flex cpk:flex-wrap cpk:gap-2 cpk:p-2", className)}
    >
      {attachments.map((attachment) => {
        const isMedia =
          attachment.type === "image" || attachment.type === "video";
        return (
          <div
            key={attachment.id}
            className={cn(
              "cpk:relative cpk:inline-flex cpk:rounded-lg cpk:overflow-hidden cpk:border cpk:border-border",
              isMedia
                ? "cpk:w-[72px] cpk:h-[72px]"
                : attachment.type === "audio"
                  ? "cpk:min-w-[200px] cpk:max-w-[280px] cpk:flex-col cpk:p-1 cpk:pr-8"
                  : "cpk:p-2 cpk:px-3 cpk:pr-8 cpk:max-w-[240px]",
            )}
          >
            {attachment.status === "uploading" && <UploadingOverlay />}
            <AttachmentPreview attachment={attachment} />
            <button
              onClick={() => onRemoveAttachment(attachment.id)}
              className={cn(
                "cpk:absolute cpk:bg-black/60 cpk:text-white cpk:border-none cpk:rounded-full cpk:w-5 cpk:h-5 cpk:flex cpk:items-center cpk:justify-center cpk:cursor-pointer cpk:text-[10px] cpk:z-20",
                isMedia ? "cpk:top-1 cpk:right-1" : "cpk:top-1.5 cpk:right-1.5",
              )}
              aria-label="Remove attachment"
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
    <div className="cpk:absolute cpk:inset-0 cpk:flex cpk:items-center cpk:justify-center cpk:bg-black/40 cpk:z-10">
      <div className="cpk:w-5 cpk:h-5 cpk:border-2 cpk:border-white cpk:border-t-transparent cpk:rounded-full cpk:animate-spin" />
    </div>
  );
}

function AttachmentPreview({ attachment }: { attachment: Attachment }) {
  if (attachment.status === "uploading") {
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
// Lightbox – fullscreen overlay for images and videos (portal to body)
// Uses the View Transition API when available for a smooth thumbnail-to-
// fullscreen morph; falls back to a simple opacity fade.
// ---------------------------------------------------------------------------

interface LightboxProps {
  onClose: () => void;
  children: React.ReactNode;
}

function Lightbox({ onClose, children }: LightboxProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="cpk:fixed cpk:inset-0 cpk:z-[9999] cpk:flex cpk:items-center cpk:justify-center cpk:bg-black/80 cpk:animate-fade-in"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="cpk:absolute cpk:top-4 cpk:right-4 cpk:text-white cpk:bg-white/10 cpk:hover:bg-white/20 cpk:rounded-full cpk:w-10 cpk:h-10 cpk:flex cpk:items-center cpk:justify-center cpk:cursor-pointer cpk:border-none cpk:z-10"
        aria-label="Close preview"
      >
        <X className="cpk:w-5 cpk:h-5" />
      </button>

      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>,
    document.body,
  );
}

type DocWithVT = Document & {
  startViewTransition?: (cb: () => void) => { finished: Promise<void> };
};

/**
 * Hook that manages lightbox open/close and uses the View Transition API to
 * morph the thumbnail into fullscreen content.
 *
 * The trick: `view-transition-name` must live on exactly ONE element at a time.
 * - Old state (thumbnail visible): name is on the thumbnail.
 * - New state (lightbox visible): name moves to the lightbox content.
 * `flushSync` ensures React commits the DOM change synchronously inside the
 * `startViewTransition` callback so the API can snapshot old → new correctly.
 */
function useLightbox() {
  const thumbnailRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const vtName = useId();

  const openLightbox = useCallback(() => {
    const thumb = thumbnailRef.current;
    const doc = document as DocWithVT;

    if (doc.startViewTransition && thumb) {
      // Old snapshot: name on the thumbnail
      thumb.style.viewTransitionName = vtName;

      doc.startViewTransition(() => {
        // New snapshot: remove from thumb (lightbox content will have it)
        thumb.style.viewTransitionName = "";
        flushSync(() => setOpen(true));
      });
    } else {
      setOpen(true);
    }
  }, []);

  const closeLightbox = useCallback(() => {
    const thumb = thumbnailRef.current;
    const doc = document as DocWithVT;

    if (doc.startViewTransition && thumb) {
      const transition = doc.startViewTransition(() => {
        // New snapshot: name back on thumbnail
        flushSync(() => setOpen(false));
        thumb.style.viewTransitionName = vtName;
      });
      // Clean up the name after animation finishes (or fails)
      transition.finished
        .then(() => {
          thumb.style.viewTransitionName = "";
        })
        .catch(() => {
          thumb.style.viewTransitionName = "";
        });
    } else {
      setOpen(false);
    }
  }, []);

  return {
    thumbnailRef,
    vtName,
    open,
    openLightbox,
    closeLightbox,
  };
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
  return (
    <div className="cpk:flex cpk:flex-col cpk:gap-1 cpk:w-full">
      <audio
        src={src}
        controls
        preload="metadata"
        className="cpk:w-full cpk:h-8"
      />
      {attachment.filename && (
        <span className="cpk:text-xs cpk:font-medium cpk:overflow-hidden cpk:text-ellipsis cpk:whitespace-nowrap">
          {attachment.filename}
        </span>
      )}
    </div>
  );
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
        className="cpk:w-[90vw] cpk:h-[90vh] cpk:max-w-[1000px] cpk:rounded-lg cpk:bg-white"
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
        className="cpk:w-[90vw] cpk:max-w-[800px] cpk:max-h-[90vh] cpk:overflow-auto cpk:rounded-lg cpk:bg-white cpk:dark:bg-gray-900 cpk:p-6"
      >
        {attachment.filename && (
          <div className="cpk:text-sm cpk:font-medium cpk:text-gray-500 cpk:dark:text-gray-400 cpk:mb-4 cpk:pb-2 cpk:border-b cpk:border-gray-200 cpk:dark:border-gray-700">
            {attachment.filename}
          </div>
        )}
        {textContent ? (
          <pre className="cpk:text-sm cpk:whitespace-pre-wrap cpk:break-words cpk:text-gray-800 cpk:dark:text-gray-200 cpk:font-mono cpk:m-0">
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
      className="cpk:flex cpk:flex-col cpk:items-center cpk:gap-4 cpk:p-8 cpk:rounded-lg cpk:bg-white cpk:dark:bg-gray-900"
    >
      <div className="cpk:w-16 cpk:h-16 cpk:rounded-xl cpk:bg-primary cpk:text-primary-foreground cpk:flex cpk:items-center cpk:justify-center cpk:text-xl cpk:font-bold">
        {getDocumentIcon(mimeType ?? "")}
      </div>
      <div className="cpk:text-center">
        <div className="cpk:text-base cpk:font-medium cpk:text-gray-800 cpk:dark:text-gray-200">
          {attachment.filename || "Document"}
        </div>
        <div className="cpk:text-sm cpk:text-gray-500 cpk:dark:text-gray-400 cpk:mt-1">
          {mimeType || "Unknown type"}
          {attachment.size != null && ` · ${formatFileSize(attachment.size)}`}
        </div>
      </div>
      <div className="cpk:text-xs cpk:text-gray-400 cpk:dark:text-gray-500">
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
        <div className="cpk:w-8 cpk:h-8 cpk:rounded-md cpk:bg-primary cpk:text-primary-foreground cpk:flex cpk:items-center cpk:justify-center cpk:text-[10px] cpk:font-semibold cpk:shrink-0">
          {getDocumentIcon(mimeType ?? "")}
        </div>
        <div className="cpk:flex cpk:flex-col cpk:min-w-0">
          <span className="cpk:text-xs cpk:font-medium cpk:break-all cpk:leading-tight">
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
