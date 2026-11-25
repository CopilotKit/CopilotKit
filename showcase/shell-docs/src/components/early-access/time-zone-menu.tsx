"use client";

import { useMemo } from "react";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { timeZoneOptions, zoneLabel } from "@/lib/early-access/time-zones";
import { BOOKER_TEXT as TEXT } from "./text";

/**
 * "Times in Pacific (PST)": the zone's name opens a menu of zones, the chosen
 * one checked. Arrow keys, Home, End, and type-ahead move through it.
 */
export function TimeZoneMenu({
  value,
  onChange,
}: {
  value: string;
  onChange: (zone: string) => void;
}) {
  const options = useMemo(() => timeZoneOptions(value), [value]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="group/zone -ms-2 inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:text-foreground motion-reduce:transition-none">
        {TEXT.timesIn}{" "}
        <span className="font-medium text-foreground underline decoration-border decoration-1 underline-offset-4 group-hover/zone:decoration-foreground/40">
          {zoneLabel(value)}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-3.5 transition-transform group-data-popup-open/zone:rotate-180 motion-reduce:transition-none"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[min(22rem,var(--available-height))] w-auto min-w-60 rounded-xl p-1.5 ring-frame-rim"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>{TEXT.timeZone}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(zone) => {
              if (typeof zone === "string" && zone !== value) onChange(zone);
            }}
          >
            {options.map((option) => (
              <DropdownMenuRadioItem
                key={option.zone}
                value={option.zone}
                className="min-h-9 rounded-lg px-2"
              >
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
