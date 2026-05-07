"use client";

/** User and assistant bubbles. Plain text only — Simple skips markdown. */

import { Bot, User } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function UserBubble({ content }: { content: string }) {
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
      <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-sm">
        <p className="whitespace-pre-wrap break-words">{content}</p>
      </div>
    </div>
  );
}

export function AssistantBubble({ content }: { content: string }) {
  return (
    <div
      data-testid="headless-message-assistant"
      className="flex w-full items-start gap-3"
    >
      <Avatar className="h-8 w-8 shrink-0 border bg-muted text-muted-foreground">
        <AvatarFallback className="bg-muted text-muted-foreground">
          <Bot className="h-4 w-4" />
        </AvatarFallback>
      </Avatar>
      <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-muted px-4 py-2.5 text-sm leading-relaxed text-foreground shadow-sm">
        <p className="whitespace-pre-wrap break-words">{content}</p>
      </div>
    </div>
  );
}
