"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { BOOKER_ID } from "./booker";

/**
 * A button to the page's booker: it scrolls the booker into view (at once
 * for reduced motion) and moves focus to it, so the next Tab reaches the
 * time zone menu, then the day tabs. Without JavaScript it still goes to
 * `#book`, as a link does.
 */
export function BookCta({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Button
      nativeButton={false}
      render={
        <a
          href={`#${BOOKER_ID}`}
          onClick={(event) => {
            const booker = document.getElementById(BOOKER_ID);
            if (!booker) return;
            event.preventDefault();
            const reduce = window.matchMedia(
              "(prefers-reduced-motion: reduce)",
            ).matches;
            booker.scrollIntoView({
              behavior: reduce ? "auto" : "smooth",
              block: "center",
            });
            booker.focus({ preventScroll: true });
          }}
        />
      }
      className={cn(
        "h-11 rounded-full bg-foreground px-5 text-base text-background hover:bg-foreground/85",
        className,
      )}
    >
      {children}
    </Button>
  );
}
