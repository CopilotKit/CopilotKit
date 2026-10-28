"use client";

import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import { FRAMEWORKS, LANGUAGES, frameworkById } from "./data";
import { rememberFramework, useLastFramework } from "./last-framework";
import { liveFramework } from "@/lib/live-scope";

/**
 * The home's primary action: pick your agent framework for the setup links and copied prompt. The last one you used is checked.
 */
export function KiteFrameworkMenu() {
  const [current] = useLastFramework();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" className="group h-11 rounded-full px-5" />
        }
      >
        Agent:{" "}
        {
          frameworkById(liveFramework(current) ? current : "built-in-agent")
            ?.name
        }
        <ChevronDown
          className="transition-transform duration-200 group-data-popup-open:rotate-180 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        sideOffset={8}
        className="max-h-[min(28rem,var(--available-height))] w-72 rounded-xl p-1.5 ring-frame-rim"
      >
        {LANGUAGES.filter((lang) =>
          FRAMEWORKS.some((f) => f.language === lang && liveFramework(f.id)),
        ).map((lang) => (
          <DropdownMenuGroup key={lang} className="not-first:mt-1">
            <DropdownMenuLabel className="px-2 pt-1.5">
              {lang}
            </DropdownMenuLabel>
            {FRAMEWORKS.filter(
              (f) => f.language === lang && liveFramework(f.id),
            ).map((f) => (
              <DropdownMenuItem
                key={f.id}
                onClick={() => {
                  rememberFramework(f.id);
                }}
                className="min-h-9 gap-2.5 rounded-lg px-2"
              >
                <FrameworkLogo slug={f.id} size={18} />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                {f.id === current ? (
                  <Check className="text-primary" aria-label="Your framework" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
