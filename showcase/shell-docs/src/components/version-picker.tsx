"use client";

import { usePathname } from "next/navigation";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isVnextChannel } from "@/lib/docs-channel";

/**
 * Each docs version is its own site: 2.x at next.docs.copilotkit.ai and 1.x
 * at docs.copilotkit.ai. Picking the other version opens the same path on
 * its site; a page that is missing there falls to its redirects or 404.
 */
const VERSIONS = [
  {
    id: "2.0",
    label: "v2.x",
    note: "Release candidate",
    origin: "https://next.docs.copilotkit.ai",
  },
  {
    id: "1.x",
    label: "v1.x",
    note: "Stable",
    origin: "https://docs.copilotkit.ai",
  },
];
/** The 2.0 docs build with DOCS_CHANNEL=vnext; every other build is 1.x. */
const CURRENT = isVnextChannel ? "2.0" : "1.x";

export function VersionPicker() {
  const pathname = usePathname();
  const current = VERSIONS.find((v) => v.id === CURRENT)!;

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
        {VERSIONS.map((v) => (
          <DropdownMenuItem
            key={v.id}
            className="gap-3"
            onClick={() => {
              if (v.id !== CURRENT) window.location.href = v.origin + pathname;
            }}
          >
            <span className="text-[13px] font-semibold tabular-nums">
              {v.label}
            </span>
            <span className="flex-1 text-xs whitespace-nowrap text-fd-muted-foreground">
              {v.note}
            </span>
            {v.id === CURRENT ? (
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
