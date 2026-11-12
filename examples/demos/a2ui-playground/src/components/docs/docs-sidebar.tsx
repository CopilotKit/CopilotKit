"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { GROUPS } from "./catalog-index";

/** `standard`: the Gen UI 2.0 standard component names, listed after the playground's own. */
export function DocsSidebar({ standard }: { standard: string[] }) {
  const pathname = usePathname();
  const current = decodeURIComponent(pathname.split("/")[2] ?? "");
  const ref = useRef<HTMLElement>(null);
  const groups = [
    ...GROUPS.map((g) => ({
      label: g.cat as string,
      items: g.items as string[],
    })),
    { label: "Gen UI 2.0 standard", items: standard },
  ];
  // Keep the active item visible when landing deep in the list.
  useEffect(() => {
    const aside = ref.current;
    const el = aside?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!aside || !el) return;
    const top = el.offsetTop - aside.clientHeight / 2;
    if (
      el.offsetTop < aside.scrollTop + 40 ||
      el.offsetTop > aside.scrollTop + aside.clientHeight - 60
    )
      aside.scrollTop = Math.max(0, top);
  }, [current]);
  return (
    <aside
      ref={ref}
      className="docs-scroll sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-[220px] flex-none overflow-y-auto py-8 pr-4 md:block"
    >
      <nav aria-label="Components" className="text-[13.5px]">
        <SideLink href="/components" active={pathname === "/components"}>
          Overview
        </SideLink>
        <SideLink href="/components/macros" active={current === "macros"}>
          Macros
        </SideLink>
        {groups.map((g) => (
          <div key={g.label} className="mt-6">
            <div className="mb-1 flex items-center justify-between px-2 text-[12.5px] font-medium text-muted-foreground">
              <span>{g.label}</span>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground/60">
                {g.items.length}
              </span>
            </div>
            {g.items.map((n) => (
              <SideLink
                key={n}
                href={`/components/${n}`}
                active={current === n}
              >
                {n}
              </SideLink>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function SideLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-[30px] items-center rounded-md px-2 font-medium transition-colors",
        active
          ? "bg-accent text-foreground"
          : "text-foreground/70 hover:bg-accent/50 hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
