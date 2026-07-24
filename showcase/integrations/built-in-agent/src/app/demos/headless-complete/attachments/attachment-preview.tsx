"use client";

/**
 * Compact chip rendered above the composer for each pending attachment.
 * Shows a thumbnail (image) or icon (document), the filename, and an X
 * button to remove. Doubles as the in-message preview rendered alongside
 * a sent user message in `chat/message-user.tsx`.
 */

import React from "react";
import { File, Loader2, X } from "lucide-react";
import type { Attachment } from "@copilotkit/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove?: (id: string) => void;
}) {
  const isImage = attachment.type === "image";
  const isUploading = attachment.status === "uploading";
  const src = isImage ? attachmentSrc(attachment) : undefined;

  return (
    <div
      className={cn(
        "group relative inline-flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5 text-xs shadow-sm",
        onRemove ? "pr-7" : "pr-2",
      )}
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
        {isUploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isImage && src ? (
          <img
            src={src}
            alt={attachment.filename ?? "attachment"}
            className="h-full w-full object-cover"
          />
        ) : (
          <File className="h-4 w-4" />
        )}
      </div>
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="max-w-[180px] truncate font-medium text-foreground">
          {attachment.filename ?? "attachment"}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {isUploading ? "uploading…" : prettyBytes(attachment.size)}
        </span>
      </div>
      {onRemove && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Remove attachment"
          onClick={() => onRemove(attachment.id)}
          className="absolute right-0.5 top-1/2 h-5 w-5 -translate-y-1/2"
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

function attachmentSrc(att: Attachment): string | undefined {
  const src = att.source;
  if (src.type === "url") return src.value;
  if (src.type === "data") {
    return `data:${src.mimeType};base64,${src.value}`;
  }
  return undefined;
}

function prettyBytes(size?: number): string {
  if (!size) return "";
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
}
