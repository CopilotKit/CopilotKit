import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        destructive:
          "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50 cursor-pointer",
        link: "text-primary underline-offset-4 hover:underline",
        assistantMessageToolbarButton: [
          "cursor-pointer",
          // Background and text
          "p-0 text-[rgb(93,93,93)] hover:bg-[#E8E8E8]",
          // Dark mode - lighter gray for better contrast
          "dark:text-[rgb(243,243,243)] dark:hover:bg-[#303030]",
          // Shape and sizing
          "h-8 w-8",
          // Interactions
          "transition-colors",
          // Hover states
          "hover:text-[rgb(93,93,93)]",
          "dark:hover:text-[rgb(243,243,243)]",
        ],
        chatInputToolbarPrimary: [
          "cursor-pointer",
          // Background and text
          "bg-black text-white",
          // Dark mode
          "dark:bg-white dark:text-black dark:focus-visible:outline-white",
          // Shape and sizing
          "rounded-full",
          // Interactions
          "transition-colors",
          // Focus states
          "focus:outline-none",
          // Hover states
          "hover:opacity-70 disabled:hover:opacity-100",
          // Disabled states
          "disabled:cursor-not-allowed disabled:bg-[#00000014] disabled:text-[rgb(13,13,13)]",
          "dark:disabled:bg-[#454545] dark:disabled:text-white ",
        ],
        chatInputToolbarSecondary: [
          "cursor-pointer",
          // Background and text
          "bg-transparent text-[#444444]",
          // Dark mode
          "dark:text-white dark:border-[#404040]",
          // Shape and sizing
          "rounded-full",
          // Interactions
          "transition-colors",
          // Focus states
          "focus:outline-none",
          // Hover states
          "hover:bg-[#f8f8f8] hover:text-[#333333]",
          "dark:hover:bg-[#404040] dark:hover:text-[#FFFFFF]",
          // Disabled states
          "disabled:cursor-not-allowed disabled:opacity-50",
          "disabled:hover:bg-transparent disabled:hover:text-[#444444]",
          "dark:disabled:hover:bg-transparent dark:disabled:hover:text-[#CCCCCC]",
        ],
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        chatInputToolbarIcon: [
          // Shape and sizing
          "h-9 w-9 rounded-full",
        ],
        chatInputToolbarIconLabel: [
          // Shape and sizing
          "h-9 px-3 rounded-full",
          // Layout
          "gap-2",
          // Typography
          "font-normal",
        ],
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
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
