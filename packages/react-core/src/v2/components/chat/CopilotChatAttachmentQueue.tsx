import React from "react";
import type { Attachment } from "@copilotkit/shared";
import { formatFileSize } from "@copilotkit/shared";
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
      className={cn(
        "cpk:flex cpk:flex-wrap cpk:gap-2 cpk:p-2",
        className,
      )}
    >
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className={cn(
            "cpk:relative cpk:inline-flex cpk:rounded-lg cpk:overflow-hidden cpk:border cpk:border-border",
            attachment.type === "image" || attachment.type === "video"
              ? "cpk:w-[72px] cpk:h-[72px]"
              : attachment.type === "audio"
                ? "cpk:min-w-[200px] cpk:max-w-[280px] cpk:flex-col cpk:p-1"
                : "cpk:p-2 cpk:px-3 cpk:max-w-[200px]",
          )}
        >
          {attachment.status === "uploading" && (
            <div className="cpk:absolute cpk:inset-0 cpk:flex cpk:items-center cpk:justify-center cpk:bg-black/40 cpk:z-10">
              <div className="cpk:w-5 cpk:h-5 cpk:border-2 cpk:border-white cpk:border-t-transparent cpk:rounded-full cpk:animate-spin" />
            </div>
          )}
          <AttachmentPreview attachment={attachment} />
          <button
            onClick={() => onRemoveAttachment(attachment.id)}
            className="cpk:absolute cpk:top-1 cpk:right-1 cpk:bg-black/60 cpk:text-white cpk:border-none cpk:rounded-full cpk:w-5 cpk:h-5 cpk:flex cpk:items-center cpk:justify-center cpk:cursor-pointer cpk:text-[10px] cpk:z-20"
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
    return <div className="cpk:w-full cpk:h-full" />;
  }

  const src = getSourceUrl(attachment);

  switch (attachment.type) {
    case "image":
      return (
        <img
          src={src}
          alt={attachment.filename || "Image attachment"}
          className="cpk:w-full cpk:h-full cpk:object-cover"
        />
      );

    case "audio":
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

    case "video":
      return attachment.thumbnail ? (
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
      );

    case "document":
      return (
        <div className="cpk:flex cpk:items-center cpk:gap-2">
          <div className="cpk:w-8 cpk:h-8 cpk:rounded-md cpk:bg-primary cpk:text-primary-foreground cpk:flex cpk:items-center cpk:justify-center cpk:text-[10px] cpk:font-semibold cpk:shrink-0">
            {getDocumentIcon(attachment.source.mimeType ?? "")}
          </div>
          <div className="cpk:flex cpk:flex-col cpk:min-w-0">
            <span className="cpk:text-xs cpk:font-medium cpk:overflow-hidden cpk:text-ellipsis cpk:whitespace-nowrap">
              {attachment.filename || "Document"}
            </span>
            {attachment.size != null && (
              <span className="cpk:text-[11px] cpk:text-muted-foreground">
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
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint"))
    return "PPT";
  if (mimeType.includes("text/")) return "TXT";
  return "FILE";
}
