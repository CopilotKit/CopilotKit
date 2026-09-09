import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "cpk:inline-flex cpk:items-center cpk:justify-center cpk:gap-2 cpk:whitespace-nowrap cpk:rounded-md cpk:text-sm cpk:font-medium cpk:transition-all cpk:disabled:pointer-events-none cpk:disabled:opacity-50 cpk:[&_svg]:pointer-events-none cpk:[&_svg:not([class*='size-'])]:size-4 cpk:shrink-0 cpk:[&_svg]:shrink-0 cpk:outline-none cpk:focus-visible:border-ring cpk:focus-visible:ring-ring/50 cpk:focus-visible:ring-[3px] cpk:aria-invalid:ring-destructive/20 cpk:dark:aria-invalid:ring-destructive/40 cpk:aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "cpk:bg-primary cpk:text-primary-foreground cpk:shadow-xs cpk:hover:bg-primary/90",
        destructive:
          "cpk:bg-destructive cpk:text-white cpk:shadow-xs cpk:hover:bg-destructive/90 cpk:focus-visible:ring-destructive/20 cpk:dark:focus-visible:ring-destructive/40 cpk:dark:bg-destructive/60",
        outline:
          "cpk:border cpk:bg-background cpk:shadow-xs cpk:hover:bg-accent cpk:hover:text-accent-foreground cpk:dark:bg-input/30 cpk:dark:border-input cpk:dark:hover:bg-input/50",
        secondary:
          "cpk:bg-secondary cpk:text-secondary-foreground cpk:shadow-xs cpk:hover:bg-secondary/80",
        ghost:
          "cpk:hover:bg-accent cpk:hover:text-accent-foreground cpk:dark:hover:bg-accent/50 cpk:cursor-pointer",
        link: "cpk:text-primary cpk:underline-offset-4 cpk:hover:underline",
        assistantMessageToolbarButton: [
          "cpk:cursor-pointer",
          // Background and text. Defaults are unchanged; the CSS variables
          // below resolve to the original colors until a theme overrides them.
          "cpk:p-0 cpk:text-[var(--cpk-message-toolbar-button-foreground)] cpk:hover:bg-[var(--cpk-message-toolbar-button-hover-background)]",
          // Shape and sizing
          "cpk:h-8 cpk:w-8",
          // Interactions
          "cpk:transition-colors",
          // Hover states
          "cpk:hover:text-[var(--cpk-message-toolbar-button-foreground)]",
        ],
        chatInputToolbarPrimary: [
          "cpk:cursor-pointer",
          // Background and text. The CSS variables default to the original
          // colors and flip in dark mode, so the default look is unchanged.
          "cpk:bg-[var(--cpk-send-button-background)] cpk:text-[var(--cpk-send-button-foreground)]",
          // Shape and sizing
          "cpk:rounded-full",
          // Interactions
          "cpk:transition-colors",
          // Focus states
          "cpk:focus:outline-none cpk:dark:focus-visible:outline-white",
          // Hover states
          "cpk:hover:opacity-70 cpk:disabled:hover:opacity-100",
          // Disabled states
          "cpk:disabled:cursor-not-allowed cpk:disabled:bg-[var(--cpk-send-button-disabled-background)] cpk:disabled:text-[var(--cpk-send-button-disabled-foreground)]",
        ],
        chatInputToolbarSecondary: [
          "cpk:cursor-pointer",
          // Background and text. The CSS variables default to the original
          // colors and flip in dark mode, so the default look is unchanged.
          "cpk:bg-transparent cpk:text-[var(--cpk-toolbar-button-foreground)] cpk:dark:border-[#404040]",
          // Shape and sizing
          "cpk:rounded-full",
          // Interactions
          "cpk:transition-colors",
          // Focus states
          "cpk:focus:outline-none",
          // Hover states
          "cpk:hover:bg-[var(--cpk-toolbar-button-hover-background)] cpk:hover:text-[var(--cpk-toolbar-button-hover-foreground)]",
          // Disabled states (kept literal so the disabled look is unchanged)
          "cpk:disabled:cursor-not-allowed cpk:disabled:opacity-50",
          "cpk:disabled:hover:bg-transparent cpk:disabled:hover:text-[#444444]",
          "cpk:dark:disabled:hover:bg-transparent cpk:dark:disabled:hover:text-[#CCCCCC]",
        ],
      },
      size: {
        default: "cpk:h-9 cpk:px-4 cpk:py-2 cpk:has-[>svg]:px-3",
        sm: "cpk:h-8 cpk:rounded-md cpk:gap-1.5 cpk:px-3 cpk:has-[>svg]:px-2.5",
        lg: "cpk:h-10 cpk:rounded-md cpk:px-6 cpk:has-[>svg]:px-4",
        icon: "cpk:size-9",
        chatInputToolbarIcon: [
          // Shape and sizing
          "cpk:h-9 cpk:w-9 cpk:rounded-full",
        ],
        chatInputToolbarIconLabel: [
          // Shape and sizing
          "cpk:h-9 cpk:px-3 cpk:rounded-full",
          // Layout
          "cpk:gap-2",
          // Typography
          "cpk:font-normal",
        ],
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const Button = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> &
    VariantProps<typeof buttonVariants> & {
      asChild?: boolean;
    }
>(function Button(
  { className, variant, size, asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      ref={ref}
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
});

export { Button, buttonVariants };
