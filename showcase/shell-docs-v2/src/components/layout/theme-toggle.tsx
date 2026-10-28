"use client";

import {
  ThemeSwitch,
  type ThemeSwitchProps,
} from "fumadocs-ui/layouts/shared/slots/theme-switch";
import { cn } from "@/lib/cn";

/**
 * Fumadocs' own theme switch, made to fit its space. With room for both
 * icons (62px) it's the stock sun-and-moon switch; squeezed narrower, the same
 * button shows just the current theme's icon, and a click still toggles. The
 * wrapper is a size container so the switch reads the space it has, not the
 * viewport. Passed as the layouts' `slots.themeSwitch`.
 */
export function AdaptiveThemeSwitch({ className, ...props }: ThemeSwitchProps) {
  return (
    <div className="@container flex w-[62px] min-w-9 shrink justify-center">
      <ThemeSwitch
        {...props}
        className={cn(
          "@max-[61px]:[&>svg:last-child]:hidden @max-[61px]:dark:[&>svg:first-child]:hidden @max-[61px]:dark:[&>svg:last-child]:block",
          className,
        )}
      />
    </div>
  );
}
