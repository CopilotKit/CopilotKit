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
          "cpk:cursor-pointer cpk:p-0",
          "cpk:size-7 cpk:rounded-md",
          "cpk:text-muted-foreground cpk:hover:bg-accent cpk:hover:text-foreground",
          "cpk:transition-colors",
        ],
        chatInputToolbarPrimary: [
          "cpk:cursor-pointer cpk:rounded-full",
          "cpk:bg-primary cpk:text-primary-foreground cpk:hover:bg-primary/85",
          "cpk:transition-[background-color,transform] cpk:active:scale-95",
          "cpk:disabled:cursor-not-allowed cpk:disabled:bg-foreground/10 cpk:disabled:text-foreground/40 cpk:disabled:opacity-100",
        ],
        chatInputToolbarSecondary: [
          "cpk:cursor-pointer cpk:rounded-full",
          "cpk:bg-transparent cpk:text-muted-foreground cpk:hover:bg-accent cpk:hover:text-foreground",
          "cpk:transition-colors",
          "cpk:disabled:cursor-not-allowed cpk:disabled:hover:bg-transparent",
        ],
      },
      size: {
        default: "cpk:h-9 cpk:px-4 cpk:py-2 cpk:has-[>svg]:px-3",
        sm: "cpk:h-8 cpk:rounded-md cpk:gap-1.5 cpk:px-3 cpk:has-[>svg]:px-2.5",
        lg: "cpk:h-10 cpk:rounded-md cpk:px-6 cpk:has-[>svg]:px-4",
        icon: "cpk:size-9",
        chatInputToolbarIcon: "cpk:size-9 cpk:rounded-full",
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
