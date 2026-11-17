"use client";

/**
 * User-side message bubble. Right-aligned avatar + primary-colored
 * bubble. Supports both a plain string `content` and the multimodal
 * `content` array (text + image/audio/video/document parts). The
 * attachment parts are rendered as `AttachmentChip`s above the text, so
 * the user can see what they sent.
 */

import React from "react";
import { User } from "lucide-react";
import type { Attachment, UserMessage } from "@copilotkit/shared";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { AttachmentChip } from "../attachments/attachment-preview";

// @region[custom-bubbles]
export function UserBubble({ content }: { content: UserMessage["content"] }) {
  const { text, attachments } = splitContent(content);
  const hasText = text.trim().length > 0;
  const hasAttachments = attachments.length > 0;
  if (!hasText && !hasAttachments) return null;

  return (
    <div
      data-testid="headless-message-user"
      data-message-role="user"
      className="flex w-full items-start gap-3 flex-row-reverse"
    >
      <Avatar className="h-8 w-8 shrink-0 border bg-primary text-primary-foreground">
        <AvatarFallback className="bg-primary text-primary-foreground">
          <User className="h-4 w-4" />
        </AvatarFallback>
      </Avatar>

      <div className="flex max-w-[80%] flex-col items-end gap-2">
        {hasAttachments && (
          <div className="flex flex-wrap justify-end gap-2">
            {attachments.map((a) => (
              <AttachmentChip key={a.id} attachment={a} />
            ))}
          </div>
        )}
        {hasText && (
          <div
            className={cn(
              "rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed shadow-sm",
              "bg-primary text-primary-foreground",
            )}
          >
            <p className="whitespace-pre-wrap break-words">{text}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function splitContent(content: UserMessage["content"]) {
  if (typeof content === "string") {
    return { text: content, attachments: [] };
  }
  let text = "";
  const attachments: Attachment[] = [];
  let i = 0;
  for (const part of content) {
    if (part.type === "text") {
      text += part.text;
      continue;
    }
    // A `file` source names a file that the model provider stores. It has
    // no bytes or URL to preview, so it gets no chip. Uploads in this demo
    // are always inline `data` sources.
    if (part.source.type === "file") continue;
    const meta: { filename?: string; size?: number } = part.metadata ?? {};
    attachments.push({
      id: `${part.type}-${i++}`,
      type: part.type,
      source: part.source,
      filename: meta.filename,
      size: meta.size,
      status: "ready",
    });
  }
  return { text, attachments };
}
// @endregion[custom-bubbles]
