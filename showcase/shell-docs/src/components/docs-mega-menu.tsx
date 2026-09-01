"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import {
  Atom,
  Blocks,
  BookOpen,
  Bot,
  Box,
  ChevronDown,
  Cloud,
  Database,
  Layers,
  Link2,
  MessageSquare,
  Radio,
  RefreshCw,
  Rocket,
  Search,
  Server,
  Sparkles,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  DOCS_MEGA_MENU_COLUMNS,
  isDocsExplorePath,
  type MegaMenuIconName,
} from "@/lib/docs-mega-menu";

const MEGA_MENU_ICONS: Record<MegaMenuIconName, LucideIcon> = {
  book: BookOpen,
  rocket: Rocket,
  terminal: Terminal,
  message: MessageSquare,
  sparkles: Sparkles,
  bot: Bot,
  layers: Layers,
  refresh: RefreshCw,
  link: Link2,
  blocks: Blocks,
  database: Database,
  search: Search,
  cloud: Cloud,
  server: Server,
  atom: Atom,
  box: Box,
  radio: Radio,
};

const HOVER_CLOSE_DELAY_MS = 160;

export function DocsMegaMenu({
  triggerClassName,
}: {
  triggerClassName?: string;
}) {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const isActive = isDocsExplorePath(pathname);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedByPointer = useRef(false);

  function clearCloseTimer() {
    if (closeTimer.current === null) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }

  function openFromPointer() {
    openedByPointer.current = true;
    clearCloseTimer();
    setOpen(true);
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      openedByPointer.current = false;
    }, HOVER_CLOSE_DELAY_MS);
  }

  useEffect(() => {
    return () => {
      clearCloseTimer();
    };
  }, []);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          openedByPointer.current = false;
          clearCloseTimer();
        }
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-2 ${triggerClassName ?? ""}`}
          aria-expanded={open}
          aria-controls={panelId}
          aria-current={isActive && !open ? "page" : undefined}
          onPointerEnter={openFromPointer}
          onPointerLeave={scheduleClose}
        >
          <BookOpen
            className="h-4 w-4 shrink-0 text-current"
            aria-hidden="true"
          />
          <span>Explore docs</span>
          <ChevronDown
            className={`h-3.5 w-3.5 text-current transition-transform duration-150 ${
              open ? "rotate-180" : ""
            }`}
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        id={panelId}
        role="region"
        align="center"
        sideOffset={12}
        className="shell-docs-mega-menu z-[80] w-[min(68rem,calc(100vw-3rem))] min-w-[min(68rem,calc(100vw-3rem))] max-w-[min(68rem,calc(100vw-3rem))] p-5"
        onPointerEnter={() => {
          openedByPointer.current = true;
          clearCloseTimer();
        }}
        onPointerLeave={scheduleClose}
        onOpenAutoFocus={(event) => {
          if (openedByPointer.current) event.preventDefault();
        }}
      >
        <nav aria-label="Explore docs">
          <div className="shell-docs-mega-menu-grid">
            {DOCS_MEGA_MENU_COLUMNS.map((column) => (
              <section key={column.title} className="min-w-0">
                <h2 className="shell-docs-mega-menu-heading">{column.title}</h2>
                <ul role="list" className="shell-docs-mega-menu-list">
                  {column.links.map((link) => {
                    const Icon = MEGA_MENU_ICONS[link.icon];
                    const featured = link.featured === true;
                    return (
                      <li key={link.href}>
                        <Link
                          href={link.href}
                          onClick={() => setOpen(false)}
                          className={
                            featured
                              ? "shell-docs-mega-menu-link shell-docs-mega-menu-link-featured"
                              : "shell-docs-mega-menu-link"
                          }
                        >
                          <Icon
                            className="shell-docs-mega-menu-icon"
                            aria-hidden="true"
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {link.label}
                            </span>
                            {link.description ? (
                              <span className="mt-0.5 block text-[11px] font-normal leading-snug text-current/70">
                                {link.description}
                              </span>
                            ) : null}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </nav>
      </PopoverContent>
    </Popover>
  );
}
