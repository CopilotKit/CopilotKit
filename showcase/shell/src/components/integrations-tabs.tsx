"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/integrations", label: "Explorer" },
  { href: "/integrations/by-feature", label: "By Feature" },
  { href: "/matrix", label: "Compare" },
];

export function IntegrationsTabs() {
  const pathname = usePathname();

  return (
    <div className="flex gap-1 mb-6">
      {TABS.map(({ href, label }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`rounded-lg px-4 py-2 text-[13px] font-medium transition-colors ${
              active
                ? "bg-[var(--accent-light)] text-[var(--accent)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
