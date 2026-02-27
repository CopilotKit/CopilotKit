import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

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
          // Background and text
          "cpk:p-0 cpk:text-[rgb(93,93,93)] cpk:hover:bg-[#E8E8E8]",
          // Dark mode - lighter gray for better contrast
          "cpk:dark:text-[rgb(243,243,243)] cpk:dark:hover:bg-[#303030]",
          // Shape and sizing
          "cpk:h-8 cpk:w-8",
          // Interactions
          "cpk:transition-colors",
          // Hover states
          "cpk:hover:text-[rgb(93,93,93)]",
          "cpk:dark:hover:text-[rgb(243,243,243)]",
        ],
        chatInputToolbarPrimary: [
          "cpk:cursor-pointer",
          // Background and text
          "cpk:bg-black cpk:text-white",
          // Dark mode
          "cpk:dark:bg-white cpk:dark:text-black cpk:dark:focus-visible:outline-white",
          // Shape and sizing
          "cpk:rounded-full",
          // Interactions
          "cpk:transition-colors",
          // Focus states
          "cpk:focus:outline-none",
          // Hover states
          "cpk:hover:opacity-70 cpk:disabled:hover:opacity-100",
          // Disabled states
          "cpk:disabled:cursor-not-allowed cpk:disabled:bg-[#00000014] cpk:disabled:text-[rgb(13,13,13)]",
          "cpk:dark:disabled:bg-[#454545] cpk:dark:disabled:text-white ",
        ],
        chatInputToolbarSecondary: [
          "cpk:cursor-pointer",
          // Background and text
          "cpk:bg-transparent cpk:text-[#444444]",
          // Dark mode
          "cpk:dark:text-white cpk:dark:border-[#404040]",
          // Shape and sizing
          "cpk:rounded-full",
          // Interactions
          "cpk:transition-colors",
          // Focus states
          "cpk:focus:outline-none",
          // Hover states
          "cpk:hover:bg-[#f8f8f8] cpk:hover:text-[#333333]",
          "cpk:dark:hover:bg-[#404040] cpk:dark:hover:text-[#FFFFFF]",
          // Disabled states
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

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
