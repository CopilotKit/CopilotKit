import React, { useState } from "react";
import type { InputContentSource } from "@copilotkit/shared";
import { getSourceUrl, getDocumentIcon } from "@copilotkit/shared";
import { cn } from "../../lib/utils";

interface CopilotChatAttachmentRendererProps {
  type: "image" | "audio" | "video" | "document";
  source: InputContentSource;
  filename?: string;
  className?: string;
}

function ImageAttachment({
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
        className={cn(
          "cpk:flex cpk:flex-col cpk:items-center cpk:justify-center cpk:rounded-lg cpk:bg-muted cpk:p-4 cpk:text-sm cpk:text-muted-foreground",
          className,
        )}
      >
        <span>Failed to load image</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt="Image attachment"
      className={cn("cpk:max-w-full cpk:h-auto cpk:rounded-lg", className)}
      onError={() => setError(true)}
    />
  );
}

export const CopilotChatAttachmentRenderer: React.FC<
  CopilotChatAttachmentRendererProps
> = ({ type, source, filename, className }) => {
  const src = getSourceUrl(source);

  switch (type) {
    case "image":
      return <ImageAttachment src={src} className={className} />;
    case "audio":
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
    case "video":
      return (
        <video
          src={src}
          controls
          preload="metadata"
          className={cn(
            "cpk:max-w-[400px] cpk:w-full cpk:rounded-lg",
            className,
          )}
        />
      );
    case "document":
      return (
        <div
          className={cn(
            "cpk:inline-flex cpk:items-center cpk:gap-2 cpk:px-3 cpk:py-2 cpk:border cpk:border-border cpk:rounded-lg cpk:bg-muted",
            className,
          )}
        >
          <span className="cpk:text-xs cpk:font-bold cpk:uppercase">
            {getDocumentIcon(source.mimeType ?? "")}
          </span>
          <span className="cpk:text-sm cpk:text-muted-foreground cpk:truncate">
            {filename || source.mimeType || "Unknown type"}
          </span>
        </div>
      );
  }
};

export default CopilotChatAttachmentRenderer;
