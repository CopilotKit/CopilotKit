"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import type { SyntheticEvent } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  BookOpen,
  ChevronDown,
  LayoutGrid,
  Maximize2,
  MessagesSquare,
  Menu,
  Moon,
  Search,
  Sun,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import "@/app/site.css";
import { readStoredDesignSystem } from "@/design-systems/context";
import { setTheme, useTheme } from "@/lib/theme";
import { cn, focusRing } from "@/lib/utils";
import { SOURCE_URL } from "@/components/start/links";
import { A2UIMark, CopilotKitKite } from "./brand";
import { CommandMenu, openSearch, useStandardNames } from "./command-menu";
import { GROUPS } from "@/components/docs/catalog-index";

type Active = "playground" | "build" | "components" | "evals" | "start";
/** `icon`: shown beside the label in the menu sheet only. */
type Item = { id: Active; label: string; href: string; icon: LucideIcon };

/** The workbench is the home page, then the way into your own app, then the component catalog. */
const NAV: Item[] = [
  { id: "playground", label: "Playground", href: "/", icon: MessagesSquare },
  { id: "start", label: "Get started", href: "/start", icon: BookOpen },
  {
    id: "components",
    label: "Components",
    href: "/components",
    icon: LayoutGrid,
  },
];

const BAR = "site-header sticky top-0 z-40 w-full border-b border-border";
/** A 36px icon button or link in the header and the menu sheet. */
const SQUARE =
  "flex size-9 flex-none items-center justify-center rounded-md border border-border bg-secondary/50 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground";

/**
 * Global site navbar: 64px, sticky, hairline bottom border. Below 960px (the width the links and the compact
 * search need) the links move into a menu sheet. The playground shrinks it to 48px in a short window
 * (compact.css). `embed` (the playground in an iframe): no nav, search or menu, which would navigate inside
 * the frame; see EmbedHeader.
 */
export function SiteHeader({
  active,
  embed,
}: {
  active?: Active;
  /** The page's query without `embed`, for the link out to the full playground. */
  embed?: { query: string };
}) {
  if (embed) return <EmbedHeader query={embed.query} />;
  return (
    <header className={BAR}>
      <div
        className="site-container flex h-[64px] min-w-0 items-center gap-3 min-[960px]:gap-5"
        data-site-bar
      >
        <Link
          href="/"
          aria-label="A2UI Playground by CopilotKit, home"
          className="flex min-w-0 flex-none items-center gap-2.5 text-foreground"
        >
          <A2UIMark className="size-[26px] flex-none" data-site-mark />
          {/* "by CopilotKit" credits the work without branding the page, set small under the name. */}
          <span className="flex min-w-0 flex-col gap-0.5 whitespace-nowrap">
            <span className="text-[16px] font-semibold leading-none tracking-tight">
              A2UI Playground
            </span>
            <span className="inline-flex items-center gap-1 text-[11.5px] leading-none text-muted-foreground">
              by
              <CopilotKitKite className="size-[11px]" />
              CopilotKit
            </span>
          </span>
        </Link>
        <span
          className="hidden h-7 w-px flex-none bg-border min-[960px]:block"
          aria-hidden="true"
        />
        <nav
          className="hidden min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] min-[960px]:flex"
          aria-label="Main"
        >
          {NAV.map((n) => (
            <NavLink
              key={n.id}
              item={n}
              active={active}
              className="whitespace-nowrap rounded-md px-3 py-1.5 text-[15px] font-medium"
            />
          ))}
        </nav>
        {/* min-w-0: the search trigger shrinks before anything here can push the header past the viewport.
            Under 960px all of it is in the menu sheet, so the header is the mark and the menu button. */}
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <div className="flex min-w-0 items-center gap-2 max-[959px]:hidden">
            <div className="min-w-0">
              <CommandMenu />
            </div>
            <SourceLink />
            <ThemeToggle />
          </div>
          <MenuSheet active={active} />
        </div>
      </div>
    </header>
  );
}

function NavLink({
  item,
  active,
  className,
}: {
  item: Item;
  active?: Active;
  className?: string;
}) {
  const on = active === item.id;
  return (
    <Link
      href={item.href}
      aria-current={on ? "page" : undefined}
      className={cn(
        "transition-colors",
        on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {item.label}
    </Link>
  );
}

/**
 * The playground in an iframe on CopilotKit's site or docs: 48px, the mark, the theme toggle and a way out to
 * the full playground in a new tab. Nothing here navigates inside the frame.
 */
function EmbedHeader({ query }: { query: string }) {
  const path = usePathname() || "/";
  const theme = useTheme();
  // The page as the visitor sees it now, without `embed`: read again on hover, focus and click, so a theme
  // or design system picked inside the frame carries over. Both go in the link, since a frame on another
  // site keeps its storage apart from the new tab's.
  const refresh = (e: SyntheticEvent<HTMLAnchorElement>) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("embed");
      url.searchParams.set("theme", theme);
      const ds = readStoredDesignSystem();
      if (ds) url.searchParams.set("ds", ds);
      e.currentTarget.href = url.toString();
    } catch {
      // Keep the server's link.
    }
  };
  return (
    <header className={BAR} data-embed>
      <div
        className="site-container flex h-[48px] min-w-0 items-center gap-2"
        data-site-bar
      >
        <span className="flex min-w-0 items-center gap-2 text-foreground">
          <A2UIMark className="size-[22px] flex-none" />
          <span className="truncate text-[15px] font-semibold leading-tight tracking-tight">
            A2UI Playground
          </span>
          <span className="hidden flex-none items-center gap-1 whitespace-nowrap text-[12.5px] leading-tight text-muted-foreground min-[560px]:inline-flex">
            by
            <CopilotKitKite className="size-[12px] translate-y-[1px]" />
            CopilotKit
          </span>
        </span>
        <div className="ml-auto flex flex-none items-center gap-1.5">
          <ThemeToggle />
          <a
            href={`${path}${query ? `?${query}` : ""}`}
            target="_blank"
            rel="noopener"
            onPointerEnter={refresh}
            onFocus={refresh}
            onClick={refresh}
            data-open-full
            // A quiet icon button beside the theme toggle, so the frame's header stays out of the answer's way.
            aria-label="Open full playground (opens in a new tab)"
            title="Open full playground"
            className="flex size-8 flex-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Maximize2 className="size-[16px]" aria-hidden />
          </a>
        </div>
      </div>
    </header>
  );
}

/** Light or dark for the whole site; the pick is remembered. */
function ThemeToggle() {
  const dark = useTheme() === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
      className={cn(SQUARE, focusRing)}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

/** The site's source on GitHub, in a new tab. */
function SourceLink() {
  return (
    <a
      href={SOURCE_URL}
      target="_blank"
      rel="noreferrer"
      aria-label="Source on GitHub"
      title="Source on GitHub"
      className={cn(SQUARE, focusRing)}
    >
      <GitHubIcon className="size-4" />
    </a>
  );
}

/**
 * The menu as a sheet from the right, for screens under 960px: search first, the pages with the current one
 * marked, then the theme and the source pinned at the foot. Radix handles focus, Escape and the backdrop.
 */
function MenuSheet({ active }: { active?: Active }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  // Search opens once the sheet has closed, so the sheet's return of focus to its button does not take it back,
  // and hands the focus back to the menu button when it closes.
  const toSearch = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const row =
    "group flex h-11 items-center gap-3 rounded-[10px] px-3 text-[15px] font-medium transition-colors";
  const rowOn = "bg-black/[0.05] text-foreground dark:bg-white/[0.07]";
  const rowOff =
    "text-muted-foreground hover:bg-black/[0.03] hover:text-foreground dark:hover:bg-white/[0.04]";
  const iconCls = "size-[18px] flex-none transition-colors";
  const iconOff = "text-muted-foreground/70 group-hover:text-foreground";
  // The catalog list starts open, so every component is one tap away.
  const pathname = usePathname();
  const current = decodeURIComponent(pathname.split("/")[2] ?? "");
  const [catalogOpen, setCatalogOpen] = useState(true);
  const standard = useStandardNames(open && catalogOpen);
  const catalog: Array<{ label: string; items: string[] }> = [
    ...GROUPS.map((g) => ({ label: g.cat, items: g.items })),
    ...(standard.length
      ? [{ label: "Gen UI 2.0 standard", items: standard }]
      : []),
  ];
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        ref={trigger}
        aria-label="Open menu"
        className={cn(SQUARE, focusRing, "min-[960px]:hidden")}
      >
        <Menu className="size-[18px]" />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          onCloseAutoFocus={(e) => {
            if (!toSearch.current) return;
            toSearch.current = false;
            e.preventDefault();
            openSearch(trigger.current);
          }}
          className="fixed inset-y-0 right-0 z-50 flex w-[min(340px,100%)] flex-col border-l border-border bg-background shadow-[-24px_0_60px_-30px_oklch(0_0_0/35%)] outline-none dark:bg-[oklch(0.145_0.004_285)] data-open:animate-in data-open:slide-in-from-right data-open:duration-300 data-closed:animate-out data-closed:slide-out-to-right data-closed:duration-200 motion-reduce:animate-none"
        >
          <div className="flex h-16 flex-none items-center justify-between border-b border-border pl-5 pr-4">
            <DialogPrimitive.Title className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight">
              <A2UIMark className="size-[22px] flex-none" />
              A2UI Playground
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label="Close menu"
              className={cn(SQUARE, focusRing)}
            >
              <X className="size-[18px]" />
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">
            Search, the pages on this site, the theme and the source
          </DialogPrimitive.Description>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4 pt-4">
            <button
              type="button"
              onClick={() => {
                toSearch.current = true;
                close();
              }}
              className={cn(
                "flex h-11 w-full flex-none items-center gap-2.5 rounded-[10px] border border-border bg-secondary/50 px-3.5 text-left text-[15px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
                focusRing,
              )}
            >
              <Search className="size-4 flex-none" aria-hidden />
              Search components
            </button>

            <nav
              aria-label="Main"
              className="mt-5 flex flex-none flex-col gap-0.5"
            >
              {NAV.filter((n) => n.id !== "components").map((n) => {
                const on = active === n.id;
                return (
                  <Link
                    key={n.id}
                    href={n.href}
                    onClick={close}
                    aria-current={on ? "page" : undefined}
                    className={cn(row, on ? rowOn : rowOff, focusRing)}
                  >
                    <n.icon
                      className={cn(iconCls, on ? "text-foreground" : iconOff)}
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    {n.label}
                  </Link>
                );
              })}
              {/* Components last, as a disclosure: open, it lists the whole catalog. */}
              <button
                type="button"
                aria-expanded={catalogOpen}
                aria-controls="menu-catalog"
                onClick={() => setCatalogOpen((v) => !v)}
                className={cn(
                  row,
                  "w-full text-left",
                  active === "components" ? rowOn : rowOff,
                  focusRing,
                )}
              >
                <LayoutGrid
                  className={cn(
                    iconCls,
                    active === "components" ? "text-foreground" : iconOff,
                  )}
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span className="flex-1">Components</span>
                <ChevronDown
                  className={cn(
                    "size-4 text-muted-foreground transition-transform duration-200",
                    catalogOpen && "rotate-180",
                  )}
                  aria-hidden
                />
              </button>
              {catalogOpen ? (
                <div
                  id="menu-catalog"
                  className="ml-[21px] border-l border-border pb-2 pl-3"
                >
                  <CatalogLink
                    href="/components"
                    on={pathname === "/components"}
                    onPick={close}
                  >
                    Overview
                  </CatalogLink>
                  <CatalogLink
                    href="/components/macros"
                    on={current === "macros"}
                    onPick={close}
                  >
                    Macros
                  </CatalogLink>
                  {catalog.map((g) => (
                    <div key={g.label} className="mt-5 first:mt-4">
                      <div className="mb-1 flex h-7 items-center justify-between rounded-[6px] bg-black/[0.035] px-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-foreground/75 dark:bg-white/[0.05]">
                        <span>{g.label}</span>
                        <span className="font-mono text-[11px] tabular-nums text-muted-foreground/60">
                          {g.items.length}
                        </span>
                      </div>
                      {g.items.map((name) => (
                        <CatalogLink
                          key={name}
                          href={`/components/${name}`}
                          on={current === name}
                          onPick={close}
                        >
                          {name}
                        </CatalogLink>
                      ))}
                    </div>
                  ))}
                </div>
              ) : null}
            </nav>
          </div>

          {/* The foot: the theme and the source, as the header's two square buttons, at the right. */}
          <div className="flex flex-none items-center justify-end gap-2 border-t border-border px-4 py-4">
            <ThemeToggle />
            <SourceLink />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** A component in the menu's catalog list. */
function CatalogLink({
  href,
  on,
  onPick,
  children,
}: {
  href: string;
  on: boolean;
  onPick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onPick}
      aria-current={on ? "page" : undefined}
      className={cn(
        "flex h-9 items-center rounded-[8px] px-2 text-[14px] font-medium transition-colors",
        on
          ? "bg-black/[0.05] text-foreground dark:bg-white/[0.07]"
          : "text-foreground/65 hover:bg-black/[0.03] hover:text-foreground dark:hover:bg-white/[0.04]",
        focusRing,
      )}
    >
      {children}
    </Link>
  );
}

/**
 * "Skip to content", the first stop on every page. It focuses the page's first <main> (or whatever follows the
 * header), so it works on any page without an id to link to.
 */
export function SkipLink() {
  return (
    <a
      href="#main"
      onClick={(e) => {
        const target =
          document.querySelector<HTMLElement>("main") ??
          document.querySelector<HTMLElement>("header.site-header + *");
        if (!target) return;
        e.preventDefault();
        if (!target.hasAttribute("tabindex"))
          target.setAttribute("tabindex", "-1");
        target.focus();
      }}
      className="sr-only rounded-md bg-foreground text-[14px] font-medium text-background focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[60] focus:px-3 focus:py-2"
    >
      Skip to content
    </a>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}
