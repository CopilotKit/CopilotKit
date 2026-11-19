"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { basePath } from "@/lib/base-path";
import { DOCS_VERSIONS } from "@/lib/docs-versions.mjs";

type Version = Pick<
  (typeof DOCS_VERSIONS)[number],
  "id" | "label" | "note" | "path"
>;

/**
 * The docs version picker beside the logo. Every version lives on
 * docs.copilotkit.ai: the stable one at the root, the others under their
 * prefix (`/v2`). Picking another version opens the same page there; a page
 * that version doesn't have falls to its redirects or 404.
 *
 * The list starts as this build's copy and is replaced by the stable docs'
 * /versions.json, so an older build still offers newer versions.
 */
export function VersionPicker() {
  const pathname = usePathname();
  const [versions, setVersions] = useState<Version[]>(DOCS_VERSIONS);

  useEffect(() => {
    let cancelled = false;
    // Not withBasePath: the list lives at the root, on the stable docs.
    fetch("/versions.json")
      .then((res) => (res.ok ? res.json() : null))
      .then((list: unknown) => {
        if (!cancelled && Array.isArray(list) && list.length > 0) {
          setVersions(list as Version[]);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const current = versions.find((v) => v.path === basePath);
  if (!current) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Docs version ${current.label}, ${current.note}`}
        className="inline-flex h-6 translate-y-px items-center gap-0.5 rounded-md px-1.5 text-xs leading-none font-semibold text-fd-muted-foreground tabular-nums transition-colors hover:bg-fd-accent hover:text-fd-foreground focus-visible:ring-2 focus-visible:ring-fd-primary/40 focus-visible:outline-none aria-expanded:bg-fd-accent aria-expanded:text-fd-foreground"
      >
        {current.label}
        <ChevronDownIcon className="size-3" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-auto min-w-56"
      >
        {versions.map((v) => (
          <DropdownMenuItem
            key={v.id}
            className="gap-3"
            onClick={() => {
              if (v.id === current.id) return;
              // A full page load: each version is its own app.
              const page = pathname === "/" ? "" : pathname;
              window.location.href = `${v.path}${page}` || "/";
            }}
          >
            <span className="text-[13px] font-semibold tabular-nums">
              {v.label}
            </span>
            <span className="flex-1 text-xs whitespace-nowrap text-fd-muted-foreground">
              {v.note}
            </span>
            {v.id === current.id ? (
              <CheckIcon className="size-3.5 text-fd-primary" aria-hidden />
            ) : (
              <span className="size-3.5" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
