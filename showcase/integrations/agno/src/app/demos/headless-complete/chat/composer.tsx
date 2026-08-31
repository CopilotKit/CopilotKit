"use client";

/**
 * Bottom-of-chat composer with attachments support.
 *
 * Layout:
 *   [paperclip icon] [textarea] [send icon]
 * with a chip row above the textarea showing pending attachments. The
 * paperclip triggers the hidden `<input type="file">` exposed by
 * `useAttachments`. Drag/drop handlers are attached to the outer
 * container via the same hook so users can drop a file anywhere on the
 * composer surface.
 */

import React, { useEffect, useRef } from "react";
import { ArrowUp, Paperclip } from "lucide-react";
import type { Attachment } from "@copilotkit/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AttachmentChip } from "../attachments/attachment-preview";

export interface ComposerProps {
  value: string;
  onChange: (next: string) => void;
  onSend: () => void;
  disabled: boolean;
  isRunning: boolean;
  // Attachments — passthrough from `useAttachments`.
  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  dragOver: boolean;
}

export function Composer({
  value,
  onChange,
  onSend,
  disabled,
  isRunning,
  attachments,
  onRemoveAttachment,
  onFileChange,
  fileInputRef,
  containerRef,
  onDragOver,
  onDragLeave,
  onDrop,
  dragOver,
}: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  return (
    <div
      ref={containerRef}
      data-testid="headless-composer"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="bg-background p-3 sm:p-4"
    >
      <div
        className={cn(
          "flex flex-col gap-2 rounded-2xl border border-border/60 bg-muted/50 p-2",
          "focus-within:bg-background focus-within:ring-2 focus-within:ring-ring/40",
          "transition-colors",
          dragOver && "ring-2 ring-primary/60",
        )}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1 pt-1">
            {attachments.map((a) => (
              <AttachmentChip
                key={a.id}
                attachment={a}
                onRemove={onRemoveAttachment}
              />
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            onChange={onFileChange}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Attach file"
            onClick={() => fileInputRef.current?.click()}
            className="h-9 w-9 shrink-0 rounded-xl"
            disabled={isRunning}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Textarea
            ref={ref}
            rows={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!disabled) onSend();
              }
            }}
            placeholder={
              isRunning
                ? "Agent is responding..."
                : "Message the agent or drop a file..."
            }
            className={cn(
              "min-h-[40px] max-h-40 flex-1 resize-none border-0 bg-transparent",
              "px-2 py-2 text-sm shadow-none",
              "focus-visible:ring-0 focus-visible:border-transparent",
            )}
          />
          <Button
            type="button"
            size="icon"
            onClick={onSend}
            disabled={disabled}
            aria-label="Send message"
            className="h-9 w-9 shrink-0 rounded-xl"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <p className="mt-2 px-1 text-center text-[11px] text-muted-foreground">
        Press{" "}
        <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">
          Enter
        </kbd>{" "}
        to send,{" "}
        <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">
          Shift+Enter
        </kbd>{" "}
        for a newline
      </p>
    </div>
  );
}
