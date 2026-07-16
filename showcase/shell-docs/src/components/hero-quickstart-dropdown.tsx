"use client";

import React from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useFramework } from "./framework-provider";
import { FrameworkLogo } from "./icons/framework-icons";

export type HeroQuickstartOption = {
  slug: string;
  name: string;
  logo?: string | null;
  href: string;
};

export function HeroQuickstartDropdown({
  options,
}: {
  options: HeroQuickstartOption[];
}) {
  const [open, setOpen] = React.useState(false);
  const { setStoredFramework } = useFramework();
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target instanceof Node ? event.target : null;
      if (!target || rootRef.current?.contains(target)) return;
      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative w-full sm:w-fit">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        className="shell-docs-radius-control inline-flex h-11 w-full items-center justify-center gap-2 border border-[var(--brand-accent)] bg-[var(--brand-accent)] px-4 text-sm font-semibold text-[var(--brand-accent-foreground)] shadow-[var(--shadow-control)] transition-colors duration-150 hover:bg-[var(--accent-strong)] sm:w-fit"
        onClick={() => setOpen((value) => !value)}
      >
        Quickstart
        <ChevronDown
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div
          className="shell-docs-radius-surface absolute left-0 top-[calc(100%+8px)] z-30 w-full min-w-[280px] overflow-hidden border border-[var(--border)] bg-[var(--card)] p-1.5 shadow-[var(--shadow-panel)] sm:w-[320px]"
          role="menu"
        >
          <div className="max-h-[360px] overflow-y-auto">
            {options.map((option) => (
              <Link
                key={option.slug}
                href={option.href}
                role="menuitem"
                className="shell-docs-radius-control group flex items-center gap-3 px-2.5 py-2.5 no-underline transition-colors hover:bg-[var(--accent-dim)]"
                onClick={() => {
                  setStoredFramework(option.slug);
                  setOpen(false);
                }}
              >
                <span
                  aria-hidden="true"
                  className="shell-docs-radius-icon flex h-8 w-8 shrink-0 items-center justify-center border border-[var(--border)] bg-[var(--accent-dim)] text-[var(--brand-accent)] transition-colors group-hover:bg-[var(--accent-light)]"
                >
                  <FrameworkLogo
                    slug={option.slug}
                    fallbackSrc={option.logo ?? undefined}
                    size={17}
                    className="text-[var(--brand-accent)]"
                  />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-[var(--foreground)] transition-colors group-hover:text-[var(--brand-accent)]">
                    {option.name}
                  </span>
                  <span className="block text-xs text-[var(--muted-foreground)]">
                    Open quickstart
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
