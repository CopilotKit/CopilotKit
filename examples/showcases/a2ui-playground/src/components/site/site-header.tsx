"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type SyntheticEvent } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ArrowUpRight, Menu, Moon, Sun, X } from "lucide-react";
import "@/app/site.css";
import { readStoredDesignSystem } from "@/design-systems/context";
import { setTheme, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { DOCS_URL, REPO_URL } from "@/components/start/links";
import { A2UIMark, CopilotKitKite } from "./brand";
import { CommandMenu } from "./command-menu";

type Active =
  | "home"
  | "playground"
  | "build"
  | "components"
  | "evals"
  | "start";
type Item = { id: Active; label: string; href: string };

/** The workbench is the home page; the catalog and the way into your own app follow it. */
const NAV: Item[] = [
  { id: "playground", label: "Playground", href: "/" },
  { id: "components", label: "Components", href: "/components" },
  { id: "start", label: "Get started", href: "/start" },
];

const BAR = "site-header sticky top-0 z-40 w-full border-b border-border";

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
          {/* "by CopilotKit" credits the work without branding the page; on a phone it drops under the name. */}
          <span className="flex min-w-0 flex-col whitespace-nowrap min-[420px]:flex-row min-[420px]:items-baseline min-[420px]:gap-2">
            <span className="text-[17px] font-semibold leading-tight tracking-tight">
              A2UI Playground
            </span>
            <span className="inline-flex items-center gap-1 text-[11.5px] leading-tight text-muted-foreground min-[420px]:text-[13px]">
              by
              <CopilotKitKite className="size-[12px] translate-y-[1px] min-[420px]:size-[13px]" />
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
        {/* min-w-0: the search trigger shrinks before anything here can push the header past the viewport. */}
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {REPO_URL ? (
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub"
              className="flex size-8 flex-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <GitHubIcon className="size-[17px]" />
            </a>
          ) : null}
          <ThemeToggle />
          <div className="min-w-0">
            <CommandMenu />
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
  onClick,
}: {
  item: Item;
  active?: Active;
  className?: string;
  onClick?: () => void;
}) {
  const on = active === item.id;
  return (
    <Link
      href={item.href}
      onClick={onClick}
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
            className="inline-flex h-8 flex-none items-center gap-1.5 rounded-md border border-border px-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {/* Under 440px: "Open", still named in full for screen readers. */}
            <span className="max-[439px]:hidden">Open full playground</span>
            <span className="min-[440px]:hidden">
              Open<span className="sr-only"> full playground</span>
            </span>
            <ArrowUpRight className="size-3.5" aria-hidden />
            <span className="sr-only"> (opens in a new tab)</span>
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
      className="flex size-8 flex-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {dark ? (
        <Sun className="size-[17px]" />
      ) : (
        <Moon className="size-[17px]" />
      )}
    </button>
  );
}

/** The nav as a sheet from the right, for screens under 960px. Radix handles focus, Escape and the backdrop. */
function MenuSheet({ active }: { active?: Active }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const row =
    "flex h-11 items-center rounded-md px-3 text-[16px] font-medium hover:bg-accent dark:hover:bg-white/[0.05]";
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        aria-label="Open menu"
        className="flex size-9 flex-none items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground min-[960px]:hidden"
      >
        <Menu className="size-[18px]" />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[min(320px,100%)] flex-col border-l border-border bg-background dark:bg-[oklch(0.145_0.004_285)] p-4 shadow-2xl outline-none data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right motion-reduce:animate-none">
          <div className="flex h-10 items-center justify-between pl-3">
            <DialogPrimitive.Title className="text-[15px] font-semibold">
              Menu
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label="Close menu"
              className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-[18px]" />
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">
            Pages on this site
          </DialogPrimitive.Description>
          <nav aria-label="Main" className="mt-3 flex flex-col">
            {NAV.map((n) => (
              <NavLink
                key={n.id}
                item={n}
                active={active}
                onClick={close}
                className={row}
              />
            ))}
          </nav>
          <div className="mt-3 flex flex-col border-t border-border pt-3">
            <a
              href={REPO_URL ?? DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className={cn(
                row,
                "gap-2 text-muted-foreground hover:text-foreground",
              )}
            >
              {REPO_URL ? "GitHub" : "CopilotKit docs"}{" "}
              <ArrowUpRight className="size-4" />
            </a>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
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

export function GitHubIcon({ className }: { className?: string }) {
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
