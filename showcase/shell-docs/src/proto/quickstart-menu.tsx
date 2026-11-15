"use client";

import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import { InputGroupAddon } from "@/components/ui/input-group";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import { useHomepageTelemetry } from "@/lib/telemetry/use-homepage-telemetry";
import { FRAMEWORKS, LANGUAGES, frameworkById } from "./data";
import { rememberFramework, useLastFramework } from "./last-framework";
import { frameworkHref } from "./routes";

/** Framework ids grouped by language, the shape Base UI's grouped list takes. */
const GROUPS = LANGUAGES.map((lang) => ({
  value: lang,
  items: FRAMEWORKS.filter((f) => f.language === lang).map((f) => f.id),
}));

const nameOf = (id: string) => frameworkById(id)?.name ?? id;

/**
 * The home's primary action: pick your agent framework, land on its
 * quickstart. Opens with the search focused; the last one you used is checked.
 */
export function QuickstartMenu() {
  const router = useRouter();
  const [current] = useLastFramework();
  const track = useHomepageTelemetry();

  return (
    <Combobox
      items={GROUPS}
      value={current ?? null}
      itemToStringLabel={nameOf}
      autoHighlight
      onValueChange={(id: string | null) => {
        if (!id) return;
        const destination = frameworkHref("d", id, "quickstart");
        track("quickstart_selected", { backend: id, destination });
        rememberFramework(id);
        router.push(destination);
      }}
    >
      <ComboboxTrigger
        render={
          <Button className="group h-11 rounded-full bg-foreground px-5 text-background hover:bg-foreground/85 data-popup-open:bg-foreground/85 [&>svg]:text-background [&>svg]:transition-transform [&>svg]:duration-200 data-popup-open:[&>svg]:rotate-180 motion-reduce:[&>svg]:transition-none" />
        }
      >
        Start the quickstart
      </ComboboxTrigger>
      <ComboboxContent
        sideOffset={8}
        className="w-72 rounded-xl ring-frame-rim"
      >
        <ComboboxInput
          showTrigger={false}
          placeholder="Find your agent framework"
          aria-label="Find your agent framework"
        >
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
        </ComboboxInput>
        <ComboboxEmpty>No framework matches.</ComboboxEmpty>
        <ComboboxList className="max-h-[min(24rem,calc(var(--available-height)-3rem))] p-1.5">
          {(group: (typeof GROUPS)[number]) => (
            <ComboboxGroup
              key={group.value}
              items={group.items}
              className="not-first:mt-1"
            >
              <ComboboxLabel>{group.value}</ComboboxLabel>
              <ComboboxCollection>
                {(id: string) => (
                  <ComboboxItem
                    key={id}
                    value={id}
                    className="min-h-9 gap-2.5 rounded-lg px-2"
                  >
                    <FrameworkLogo slug={id} size={18} />
                    <span className="min-w-0 flex-1 truncate">
                      {nameOf(id)}
                    </span>
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
