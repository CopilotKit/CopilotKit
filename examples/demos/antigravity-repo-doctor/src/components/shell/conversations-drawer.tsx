"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

/**
 * The thread list as a left drawer, for screens below xl where the sidebar is
 * hidden. Closes on Escape, on the backdrop and on the close button; the
 * caller closes it when a conversation is picked.
 */
export function ConversationsDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 xl:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Conversations"
    >
      <button
        type="button"
        aria-label="Close conversations"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div className="enter absolute inset-y-0 left-0 flex w-[min(320px,calc(100vw-48px))] flex-col bg-surface shadow-[0_18px_48px_-20px_oklch(0_0_0/45%)]">
        <button
          ref={closeButton}
          type="button"
          onClick={onClose}
          aria-label="Close conversations"
          className="absolute top-2.5 right-2.5 z-10 flex size-9 items-center justify-center rounded-lg text-dim transition-colors hover:bg-tint-2 hover:text-text"
        >
          <X className="size-[18px]" aria-hidden />
        </button>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}
