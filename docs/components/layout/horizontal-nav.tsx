"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { type ReactNode } from "react";
import { isActive } from "@/components/react/subdocs-menu";

export interface NavItem {
  title: ReactNode;
  url: string;
  icon?: ReactNode;
}

export function HorizontalNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center h-full">
      {items.map((item) => (
        <Link
          key={item.url}
          href={item.url}
          className={cn(
            "px-4 py-2 flex items-center gap-2 text-sm font-medium transition-colors border-b-2 hover:border-foreground/40",
            isActive(item.url, pathname, true)
              ? "text-foreground border-foreground"
              : "text-muted-foreground border-transparent"
          )}
        >
          {item.icon && <span className="w-4 h-4">{item.icon}</span>}
          {item.title}
        </Link>
      ))}
    </nav>
  );
}
