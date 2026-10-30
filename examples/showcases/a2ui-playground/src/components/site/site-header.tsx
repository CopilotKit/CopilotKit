"use client";

import Link from "next/link";
import { useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ArrowUpRight, Menu, X } from "lucide-react";
import "@/app/site.css";
import { cn } from "@/lib/utils";
import { DOCS_URL, REPO_URL } from "@/components/start/links";
import { A2UIMark, CopilotKitKite, CopilotKitWordmark } from "./brand";
import { CommandMenu } from "./command-menu";

type Active =
  | "home"
  | "playground"
  | "build"
  | "components"
  | "skills"
  | "evals"
  | "start";
type Item = { id: Active; label: string; href: string };

/** The workbench is the home page (the logo); every page here is a step after it. */
const NAV: Item[] = [
  { id: "components", label: "Components", href: "/components" },
  { id: "skills", label: "Skills", href: "/skills" },
  { id: "start", label: "Get started", href: "/start" },
];

/** Global site navbar: 64px, sticky, hairline bottom border. Below 960px (the width the links and the compact search need) the links move into a menu sheet. */
export function SiteHeader({ active }: { active?: Active }) {
  return (
    <header className="site-header sticky top-0 z-40 w-full border-b border-border">
      <div className="site-container flex h-[64px] min-w-0 items-center gap-3 min-[960px]:gap-5">
        <Link
          href="/"
          aria-label="A2UI Playground home"
          className="flex flex-none items-center gap-2.5 text-foreground"
        >
          <CopilotKitKite className="size-[24px]" />
          <CopilotKitWordmark className="h-[17px] w-auto translate-y-[1px] sm:h-[21px]" />
          <span
            className="px-1 text-[18px] font-light text-muted-foreground/70"
            aria-hidden="true"
          >
            ×
          </span>
          <A2UIMark className="size-[26px]" />
          <span className="text-[21px] font-semibold tracking-tight text-foreground">
            A2UI
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

/** The nav as a sheet from the right, for screens under 960px. Radix handles focus, Escape and the backdrop. */
function MenuSheet({ active }: { active?: Active }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const row =
    "flex h-11 items-center rounded-md px-3 text-[16px] font-medium hover:bg-white/[0.05]";
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
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[min(320px,100%)] flex-col border-l border-border bg-[oklch(0.145_0.004_285)] p-4 shadow-2xl outline-none data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right motion-reduce:animate-none">
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
            <NavLink
              item={{ id: "playground", label: "Playground", href: "/" }}
              active={active}
              onClick={close}
              className={row}
            />
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
