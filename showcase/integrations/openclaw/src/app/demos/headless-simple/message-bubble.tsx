"use client";

/** User and assistant bubbles. Plain text only — Simple skips markdown. */

import { Bot, User } from "lucide-react";

export function UserBubble({ content }: { content: string }) {
  return (
    <div
      data-testid="headless-message-user"
      data-message-role="user"
      className="flex w-full flex-row-reverse items-start gap-3"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white">
        <User className="h-4 w-4" />
      </div>
      <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-indigo-600 px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm">
        <p className="whitespace-pre-wrap break-words">{content}</p>
      </div>
    </div>
  );
}

export function AssistantBubble({ content }: { content: string }) {
  return (
    <div
      data-testid="headless-message-assistant"
      data-message-role="assistant"
      className="flex w-full items-start gap-3"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-600">
        <Bot className="h-4 w-4" />
      </div>
      <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-neutral-100 px-4 py-2.5 text-sm leading-relaxed text-neutral-900 shadow-sm">
        <p className="whitespace-pre-wrap break-words">{content}</p>
      </div>
    </div>
  );
}
