"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/chat-ui", label: "Chat UI" },
  { href: "/controlled", label: "Controlled" },
  { href: "/declarative", label: "Declarative" },
  { href: "/open", label: "Open ended" },
];

export function SiteNav() {
  const pathname = usePathname();

  return (
    <header className="shrink-0 border-b border-[var(--line)] bg-[var(--surface)]">
      <div className="max-w-[1480px] mx-auto px-5 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: "var(--accent)" }}
          />
          <span className="font-display text-[15px] font-semibold tracking-tight text-[var(--ink)]">
            Agent Design System
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`px-3 py-1.5 rounded-md text-[13px] transition ${
                  active
                    ? "bg-[var(--surface-soft)] text-[var(--ink)] border border-[var(--line)]"
                    : "text-[var(--muted)] hover:text-[var(--ink)] border border-transparent"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
