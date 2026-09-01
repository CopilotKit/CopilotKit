"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Star } from "lucide-react";
import {
  INTELLIGENCE_DOCS_HREF,
  isIntelligenceDocsPath,
} from "@/lib/docs-mega-menu";

export function SidebarIntelligenceEntry() {
  const pathname = usePathname() ?? "/";
  const active = isIntelligenceDocsPath(pathname);

  return (
    <Link
      href={INTELLIGENCE_DOCS_HREF}
      className={`shell-docs-intelligence-entry ${
        active ? "shell-docs-intelligence-entry-active" : ""
      }`}
      aria-current={active ? "page" : undefined}
    >
      <Star className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">Intelligence</span>
    </Link>
  );
}
