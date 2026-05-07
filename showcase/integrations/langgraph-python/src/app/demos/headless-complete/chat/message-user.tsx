"use client";

/**
 * User-side message bubble. Right-aligned avatar + primary-colored
 * bubble. Supports both legacy string `content` and the multimodal
 * `content` array (text + image/audio/video/document parts) — the
 * attachment parts are rendered as `AttachmentChip`s above the text so
 * the user can see what they sent.
 */

import React from "react";
import { User } from "lucide-react";
import type { Attachment } from "@copilotkit/shared";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { AttachmentChip } from "../attachments/attachment-preview";

type MultimodalPart =
  | { type: "text"; text: string }
  | {
      type: "image" | "audio" | "video" | "document";
      source:
        | { type: "data"; value: string; mimeType: string }
        | { type: "url"; value: string; mimeType?: string };
      metadata?: { filename?: string; size?: number } & Record<string, unknown>;
    };

export function UserBubble({
  content,
}: {
  content: string | MultimodalPart[];
}) {
  const { text, attachments } = splitContent(content);
  const hasText = text.trim().length > 0;
  const hasAttachments = attachments.length > 0;
  if (!hasText && !hasAttachments) return null;

  return (
    <div
      data-testid="headless-message-user"
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

function splitContent(content: string | MultimodalPart[]): {
  text: string;
  attachments: Attachment[];
} {
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
    const meta = (part.metadata ?? {}) as {
      filename?: string;
      size?: number;
    };
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
