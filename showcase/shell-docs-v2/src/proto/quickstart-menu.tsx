"use client";

import { useRouter } from "next/navigation";
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
import { useHomepageTelemetry } from "@/lib/telemetry/use-homepage-telemetry";
import { FRAMEWORKS, LANGUAGES } from "./data";
import { rememberFramework, useLastFramework } from "./last-framework";
import { frameworkHref } from "./routes";

/**
 * The home's primary action: pick your agent framework, land on its
 * quickstart. The last one you used is checked.
 */
export function QuickstartMenu() {
  const router = useRouter();
  const [current] = useLastFramework();
  const track = useHomepageTelemetry();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button className="group h-11 rounded-full bg-foreground px-5 text-background hover:bg-foreground/85 data-popup-open:bg-foreground/85" />
        }
      >
        Start the quickstart
        <ChevronDown
          className="transition-transform duration-200 group-data-popup-open:rotate-180 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        sideOffset={8}
        className="max-h-[min(28rem,var(--available-height))] w-72 rounded-xl p-1.5 ring-frame-rim"
      >
        {LANGUAGES.map((lang) => (
          <DropdownMenuGroup key={lang} className="not-first:mt-1">
            <DropdownMenuLabel className="px-2 pt-1.5">
              {lang}
            </DropdownMenuLabel>
            {FRAMEWORKS.filter((f) => f.language === lang).map((f) => (
              <DropdownMenuItem
                key={f.id}
                onClick={() => {
                  const destination = frameworkHref("d", f.id, "quickstart");
                  track("quickstart_selected", { backend: f.id, destination });
                  rememberFramework(f.id);
                  router.push(destination);
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
