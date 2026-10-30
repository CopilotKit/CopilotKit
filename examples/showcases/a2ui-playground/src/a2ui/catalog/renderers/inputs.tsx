"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { format as formatDate, isValid, parseISO } from "date-fns";
import { CalendarDays, Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { iconFor } from "./data";
import { asArray, formatNumber } from "./format";
import type { RendererMap } from "./types";
import { useBound } from "./use-bound";

type Opt = { value: string; label: string; description?: string };

function cleanOptions(options: unknown): Opt[] {
  return asArray<Opt>(options).filter((o) => !!o && typeof o === "object" && typeof o.value === "string").map((o) => ({ ...o, label: typeof o.label === "string" && o.label ? o.label : o.value }));
}

function Field({ id, label, hint, right, children }: { id: string; label?: string; hint?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="a2-enter flex w-full min-w-0 flex-col gap-1.5">
      {label || right ? (
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          {label ? (
            <Label htmlFor={id} className="truncate text-[12.5px] font-medium text-foreground/90">
              {label}
            </Label>
          ) : (
            <span />
          )}
          {right}
        </div>
      ) : null}
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const control = "h-8.5 text-[13px] bg-white/[0.025] dark:bg-white/[0.025] border-white/[0.09] shadow-none";

const buttonVariant = {
  default: "default",
  primary: "default",
  secondary: "secondary",
  outline: "outline",
  ghost: "ghost",
  borderless: "ghost",
  destructive: "destructive",
} as const;

type InputKeys = "Combobox" | "Switch" | "DatePicker" | "ButtonGroup" | "ChipSelect";

export const inputRenderers: RendererMap<InputKeys> = {
  Combobox: ({ props }) => {
    const id = useId();
    const [open, setOpen] = useState(false);
    const [value, setValue] = useBound<string>(props.value, props.setValue, "");
    const options = cleanOptions(props.options);
    const selected = options.find((o) => o.value === value);
    return (
      <Field id={id} label={props.label}>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              id={id}
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className={cn(control, "w-full min-w-0 justify-between px-2.5 font-normal")}
            >
              <span className={cn("truncate", !selected && "text-muted-foreground")}>{selected?.label ?? props.placeholder ?? "Search options"}</span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-52 p-0">
            <Command>
              <CommandInput placeholder="Search" className="text-[13px]" />
              <CommandList>
                <CommandEmpty className="py-5 text-[12.5px] text-muted-foreground">No match found</CommandEmpty>
                <CommandGroup>
                  {options.map((o) => (
                    <CommandItem
                      key={o.value}
                      value={`${o.label} ${o.value}`}
                      data-checked={o.value === value}
                      onSelect={() => {
                        setValue(o.value);
                        setOpen(false);
                      }}
                      className="text-[13px]"
                    >
                      {o.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </Field>
    );
  },

  Switch: ({ props }) => {
    const id = useId();
    const [checked, setChecked] = useBound<boolean>(props.value, props.setValue, false);
    return (
      <div className="a2-enter a2-well flex w-full min-w-0 items-center justify-between gap-4 px-3.5 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Label htmlFor={id} className="text-[13px] font-medium text-foreground/90">
            {props.label}
          </Label>
          {props.description ? <p className="text-[11.5px] leading-relaxed text-muted-foreground">{props.description}</p> : null}
        </div>
        <Switch id={id} checked={checked} onCheckedChange={setChecked} />
      </div>
    );
  },

  DatePicker: ({ props }) => {
    const id = useId();
    const [open, setOpen] = useState(false);
    const [value, setValue] = useBound<string>(props.value, props.setValue, "");
    const date = useMemo(() => {
      if (!value) return undefined;
      const d = parseISO(value);
      return isValid(d) ? d : undefined;
    }, [value]);
    return (
      <Field id={id} label={props.label}>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button id={id} variant="outline" className={cn(control, "w-full min-w-0 justify-start gap-2 px-2.5 font-normal")}>
              <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />
              <span className={cn("truncate", !date && "text-muted-foreground")}>{date ? formatDate(date, "EEE, MMM d, yyyy") : props.placeholder ?? "Pick a date"}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="single"
              selected={date}
              defaultMonth={date}
              onSelect={(d) => {
                if (d) setValue(formatDate(d, "yyyy-MM-dd"));
                setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      </Field>
    );
  },

  ButtonGroup: ({ props }) => {
    const id = useId();
    const [value, setValue] = useBound<string>(props.value, props.setValue, "");
    const options = cleanOptions(props.options);
    return (
      <Field id={id} label={props.label}>
        <ToggleGroup
          id={id}
          type="single"
          spacing={0}
          value={value}
          onValueChange={(v: string) => v && setValue(v)}
          className="w-fit max-w-full overflow-x-auto rounded-lg border border-white/[0.09] bg-white/[0.025] p-0.5"
        >
          {options.map((o) => (
            <ToggleGroupItem
              key={o.value}
              value={o.value}
              className="h-7 rounded-md! px-3 text-[12.5px] font-medium text-muted-foreground data-[state=on]:bg-white/[0.09] data-[state=on]:text-foreground data-[state=on]:shadow-[0_1px_2px_oklch(0_0_0/35%)]"
            >
              {o.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>
    );
  },

  ChipSelect: ({ props }) => {
    const id = useId();
    const [value, setValue] = useBound<string[]>(props.value, props.setValue, []);
    const options = cleanOptions(props.options);
    const selected = Array.isArray(value) ? value : [];
    return (
      <Field id={id} label={props.label} right={selected.length ? <span className="text-[11px] text-muted-foreground tabular-nums">{selected.length} selected</span> : null}>
        <ToggleGroup id={id} type="multiple" spacing={1.5} value={selected} onValueChange={(v: string[]) => setValue(v)} className="flex-wrap justify-start">
          {options.map((o) => {
            const on = selected.includes(o.value);
            return (
              <ToggleGroupItem
                key={o.value}
                value={o.value}
                className={cn(
                  "h-7 gap-1 rounded-full! border px-3 text-[12.5px] font-medium transition-colors",
                  on
                    ? "border-[color-mix(in_oklch,var(--a2-accent)_50%,transparent)] bg-[color-mix(in_oklch,var(--a2-accent)_14%,transparent)]! text-(--a2-accent)"
                    : "border-white/[0.1] bg-white/[0.02] text-foreground/80 hover:bg-white/[0.05]",
                )}
              >
                {on ? <Check className="size-3" strokeWidth={2.75} /> : null}
                {o.label}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </Field>
    );
  },
};
