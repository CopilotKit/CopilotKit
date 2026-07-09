"use client";

import * as Popover from "@radix-ui/react-popover";
import { Check, Monitor, MoonStar, SunMedium } from "lucide-react";
import { useTheme } from "next-themes";
import * as React from "react";

import { cn } from "@/lib/cn";

const THEME_OPTIONS = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: SunMedium },
  { value: "dark", label: "Dark", Icon: MoonStar },
] as const;

type ThemeMode = (typeof THEME_OPTIONS)[number]["value"];

function isThemeMode(value: string | undefined): value is ThemeMode {
  return THEME_OPTIONS.some((option) => option.value === value);
}

export function ThemeSwitch({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = React.useState(false);
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const currentMode = isThemeMode(theme) ? theme : "system";
  const currentOption =
    THEME_OPTIONS.find((option) => option.value === currentMode) ??
    THEME_OPTIONS[0];
  const CurrentIcon = currentOption.Icon;

  const selectTheme = React.useCallback(
    (mode: ThemeMode, close = true) => {
      setTheme(mode);
      if (close) setOpen(false);
    },
    [setTheme],
  );

  const onGroupKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const currentIndex = optionRefs.current.findIndex(
        (option) => option === document.activeElement,
      );
      let nextIndex: number | null = null;

      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        nextIndex = (Math.max(currentIndex, 0) + 1) % THEME_OPTIONS.length;
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        nextIndex =
          (currentIndex <= 0 ? THEME_OPTIONS.length : currentIndex) - 1;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = THEME_OPTIONS.length - 1;
      }

      if (nextIndex === null) return;
      event.preventDefault();
      const option = THEME_OPTIONS[nextIndex];
      optionRefs.current[nextIndex]?.focus();
      selectTheme(option.value, false);
    },
    [selectTheme],
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Theme: ${currentOption.label}`}
          title={`Theme: ${currentOption.label}`}
          className={cn(
            "shell-docs-radius-control flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-muted)] shadow-[var(--shadow-control)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)] motion-reduce:transition-none",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border)] focus-visible:ring-offset-1",
            className,
          )}
        >
          <CurrentIcon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const currentIndex = THEME_OPTIONS.findIndex(
              (option) => option.value === currentMode,
            );
            optionRefs.current[Math.max(currentIndex, 0)]?.focus();
          }}
          className="shell-docs-radius-surface z-[220] w-36 border border-[var(--border)] bg-[var(--bg-surface)] p-1.5 text-[var(--text)] shadow-[var(--shadow-panel)] outline-none motion-reduce:transition-none"
        >
          <div
            role="radiogroup"
            aria-label="Theme"
            onKeyDown={onGroupKeyDown}
            className="flex flex-col gap-1"
          >
            {THEME_OPTIONS.map(({ value, label, Icon }, index) => {
              const selected = value === currentMode;
              return (
                <button
                  key={value}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => selectTheme(value)}
                  className={cn(
                    "shell-docs-radius-control flex h-10 w-full items-center gap-2 px-2.5 text-left text-sm transition-colors motion-reduce:transition-none",
                    selected
                      ? "bg-[var(--bg-elevated)] text-[var(--text)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="flex-1">{label}</span>
                  {selected ? (
                    <Check
                      className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]"
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
