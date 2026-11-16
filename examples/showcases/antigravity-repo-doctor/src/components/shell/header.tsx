"use client";

import Image from "next/image";
import { Menu, MessagesSquare, Moon, SquarePen, Sun, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";
import { useAutoApprove } from "@/lib/auto-approve";
import { cn } from "@/lib/cn";
import type { DemoUser } from "@/lib/user";
import { NameChip } from "./name-chip";

export function Header({
  user,
  onUserChange,
  onNewThread,
  onOpenConversations,
  showNewThread,
}: {
  user: DemoUser | null;
  onUserChange: (user: DemoUser) => void;
  onNewThread: () => void;
  /** Set when saved conversations exist; opens them below xl. */
  onOpenConversations?: () => void;
  /** Off when the conversation list carries its own New conversation button. */
  showNewThread: boolean;
}) {
  const { theme, toggle } = useTheme();
  const { autoApprove, setAutoApprove } = useAutoApprove();
  // Opens on a first visit so phones see the name prompt inside it.
  const [menuOpen, setMenuOpen] = useState(user === null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node))
        setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) =>
      event.key === "Escape" && setMenuOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const autoSwitch = (labelled: boolean) => (
    <button
      type="button"
      role="switch"
      aria-checked={autoApprove}
      onClick={() => setAutoApprove(!autoApprove)}
      title="Approves every action for you, except pushes"
      data-testid="auto-approve"
      className={cn(
        "flex h-10 items-center gap-2.5 rounded-xl border px-3 text-[15px] font-medium transition-colors",
        labelled && "w-full justify-between",
        autoApprove
          ? "border-accent/50 bg-accent/10 text-text"
          : "border-line bg-panel text-dim hover:border-line-strong hover:text-text",
      )}
    >
      {labelled && <span>Auto-approve</span>}
      <span
        aria-hidden
        className={cn(
          "relative h-5 w-9 flex-none rounded-full transition-colors",
          autoApprove ? "bg-accent" : "bg-faint/50",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-4 rounded-full bg-white shadow transition-[left]",
            autoApprove ? "left-[18px]" : "left-0.5",
          )}
        />
      </span>
      {!labelled && <span>Auto-approve</span>}
    </button>
  );

  return (
    <header className="flex h-[76px] flex-none items-center justify-between gap-2 border-b border-line bg-bg px-4 sm:gap-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2 text-[20px] font-semibold tracking-tight sm:gap-3.5">
        {onOpenConversations && (
          <button
            type="button"
            onClick={onOpenConversations}
            aria-label="Conversations"
            title="Conversations"
            data-testid="open-conversations"
            className={cn(iconButton, "max-sm:hidden xl:hidden")}
          >
            <MessagesSquare className="size-[18px]" aria-hidden />
          </button>
        )}
        <span className="flex items-center gap-2.5">
          <Image
            src="/logos/antigravity.svg"
            alt=""
            width={32}
            height={32}
            priority
          />
          <span className="max-lg:sr-only">Antigravity</span>
        </span>
        <span
          className="text-[18px] font-normal text-faint max-lg:hidden"
          aria-hidden
        >
          ×
        </span>
        <span className="flex items-center gap-2.5">
          <Image
            src="/logos/copilotkit.svg"
            alt=""
            width={30}
            height={32}
            priority
          />
          <span className="max-lg:sr-only">CopilotKit</span>
        </span>
        <span className="h-6 w-px flex-none bg-line" aria-hidden />
        <span className="truncate">Repo Doctor</span>
      </div>

      {/* Wide screens: every control inline. */}
      <div className="flex flex-none items-center gap-3 max-sm:hidden">
        {autoSwitch(false)}
        <ThemeButton theme={theme} toggle={toggle} />
        <NameChip user={user} onChange={onUserChange} />
        {showNewThread && <NewThreadButton onClick={onNewThread} />}
      </div>

      {/* Phones: conversations, then one menu with the rest. */}
      <div className="flex flex-none items-center gap-2 sm:hidden">
        {showNewThread && <NewThreadButton onClick={onNewThread} />}
        {onOpenConversations && (
          <button
            type="button"
            onClick={onOpenConversations}
            aria-label="Conversations"
            className={iconButton}
          >
            <MessagesSquare className="size-[18px]" aria-hidden />
          </button>
        )}
        <div ref={menu} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Menu"
            aria-expanded={menuOpen}
            className={iconButton}
          >
            {menuOpen ? (
              <X className="size-[18px]" aria-hidden />
            ) : (
              <Menu className="size-[18px]" aria-hidden />
            )}
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-12 z-50 flex w-[min(280px,calc(100vw-32px))] flex-col gap-2 rounded-2xl border border-line bg-panel p-3 shadow-lg">
              {autoSwitch(true)}
              <button
                type="button"
                onClick={toggle}
                className="flex h-10 w-full items-center justify-between rounded-xl border border-line bg-panel px-3 text-[15px] font-medium text-text transition-colors hover:border-line-strong"
              >
                <span>{theme === "dark" ? "Light theme" : "Dark theme"}</span>
                {theme === "dark" ? (
                  <Sun className="size-[18px]" aria-hidden />
                ) : (
                  <Moon className="size-[18px]" aria-hidden />
                )}
              </button>
              <NameChip user={user} onChange={onUserChange} full />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

const iconButton =
  "flex size-10 flex-none items-center justify-center rounded-xl border border-line bg-panel text-dim transition-colors hover:border-line-strong hover:text-text";

function ThemeButton({ theme, toggle }: { theme: string; toggle: () => void }) {
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={
        theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
      }
      title={theme === "dark" ? "Light theme" : "Dark theme"}
      className={iconButton}
    >
      {theme === "dark" ? (
        <Sun className="size-[18px]" aria-hidden />
      ) : (
        <Moon className="size-[18px]" aria-hidden />
      )}
    </button>
  );
}

function NewThreadButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="New conversation"
      className="flex h-10 items-center gap-2 rounded-xl border border-line bg-panel px-3 text-[15.5px] font-medium text-text transition-colors hover:border-line-strong hover:bg-raised"
    >
      <SquarePen className="size-[18px]" aria-hidden />
      <span className="max-sm:hidden">New conversation</span>
    </button>
  );
}
