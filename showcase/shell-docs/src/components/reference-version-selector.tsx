"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReferenceVersion } from "@/lib/reference-items";

export type { ReferenceVersion };

export type ReferenceVersionOption = {
  version: ReferenceVersion;
  href: string;
};

// The selector now switches between SDKs, not just React versions. Labels
// are user-facing; keep them in sync with REFERENCE_VERSIONS.
const VERSION_LABELS: Record<ReferenceVersion, string> = {
  v2: "React (V2)",
  v1: "React (V1)",
  "react-native": "React Native",
  vue: "Vue",
  angular: "Angular",
  core: "Core (TypeScript)",
  channels: "Channels",
};

export function ReferenceVersionSelector({
  activeVersion,
  options,
}: {
  activeVersion: ReferenceVersion;
  options: ReferenceVersionOption[];
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!target) return;
      if (
        panelRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div>
      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="shell-docs-radius-control flex h-12 w-full cursor-pointer items-center gap-2 border border-[var(--nav-control-border)] bg-[var(--accent-dim)] p-1.5 text-[13px] font-medium text-[var(--text)] shadow-[var(--shadow-control)] transition-colors hover:border-[var(--nav-control-border-hover)] hover:bg-[var(--accent-light)]"
        >
          <span
            className="shell-docs-picker-icon-chip h-8 w-8 shrink-0 text-base"
            aria-hidden="true"
          >
            🪁
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate leading-tight">
              {VERSION_LABELS[activeVersion]}
            </span>
            <span className="mt-0.5 block text-[9px] uppercase leading-tight tracking-wider text-[var(--text-faint)]">
              SDK
            </span>
          </span>
          <ChevronDown className="mr-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
        </button>

        {open && (
          <div
            ref={panelRef}
            role="listbox"
            className="shell-docs-radius-surface absolute left-0 right-0 top-full z-50 mt-1 border border-[var(--border)] bg-[var(--bg-surface)] p-2 shadow-[var(--shadow-panel)]"
          >
            {options.map(({ version, href }) => {
              const active = version === activeVersion;
              return (
                <Link
                  key={version}
                  href={href}
                  role="option"
                  aria-selected={active}
                  onClick={() => setOpen(false)}
                  className={[
                    "shell-docs-radius-control flex w-full items-center gap-2 px-2 py-1.5 text-[13px] transition-colors",
                    active
                      ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]",
                  ].join(" ")}
                >
                  <span aria-hidden="true" className="shrink-0 text-sm">
                    🪁
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {VERSION_LABELS[version]}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
