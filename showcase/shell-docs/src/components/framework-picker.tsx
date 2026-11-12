"use client";

import { Search } from "lucide-react";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import { InputGroupAddon } from "@/components/ui/input-group";
import { cn } from "@/lib/cn";
import { frameworkById } from "@/proto/data";

const nameOf = (id: string) => frameworkById(id)?.name ?? id;

/**
 * The agent framework picker: a pill with the chosen framework's logo that
 * opens a searchable, height-capped list of frameworks with their logos
 * (shadcn Combobox). The playground's toolbar and Ask CopilotKit's quickstart
 * card share it.
 */
export function FrameworkPicker({
  value,
  frameworks,
  onValueChange,
  disabled,
  align = "start",
  className,
}: {
  value: string;
  /** Framework ids, in the order to list them. */
  frameworks: readonly string[];
  onValueChange: (id: string) => void;
  disabled?: boolean;
  align?: "start" | "end";
  className?: string;
}) {
  return (
    <Combobox
      items={frameworks}
      value={value}
      onValueChange={(id) => id && onValueChange(id)}
      itemToStringLabel={nameOf}
      disabled={disabled}
    >
      <ComboboxTrigger
        aria-label={`Agent framework: ${nameOf(value)}`}
        render={
          <Button
            variant="outline"
            className={cn(
              "justify-start gap-2 rounded-full ps-2.5 pe-2.5",
              className,
            )}
          />
        }
      >
        <FrameworkLogo slug={value} size={16} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-start">
          {nameOf(value)}
        </span>
      </ComboboxTrigger>
      <ComboboxContent align={align} className="w-72">
        <ComboboxInput
          showTrigger={false}
          placeholder="Search frameworks"
          aria-label="Search frameworks"
        >
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
        </ComboboxInput>
        <ComboboxEmpty>No framework matches.</ComboboxEmpty>
        <ComboboxList>
          {(id: string) => (
            <ComboboxItem key={id} value={id} className="gap-2.5 py-1.5">
              <FrameworkLogo slug={id} size={16} className="shrink-0" />
              {nameOf(id)}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
