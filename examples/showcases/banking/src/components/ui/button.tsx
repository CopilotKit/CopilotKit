import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-full text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
  {
    variants: {
      variant: {
        // Signature violet→indigo gradient pill with a soft glow.
        default:
          "brand-gradient text-brand-foreground shadow-[0_8px_20px_hsl(252_83%_60%/0.28)] hover:shadow-[0_12px_28px_hsl(252_83%_60%/0.4)] hover:brightness-[1.05]",
        destructive: "bg-negative text-white shadow-sm hover:bg-negative/90",
        outline:
          "border border-hairline bg-surface text-ink shadow-soft hover:bg-brand-soft hover:text-brand-indigo hover:border-brand/40",
        secondary:
          "bg-brand-soft text-brand-indigo shadow-sm hover:bg-brand-soft/70 dark:text-brand-violet",
        ghost:
          "text-ink hover:bg-brand-soft hover:text-brand-indigo dark:hover:text-brand-violet",
        link: "text-brand-indigo underline-offset-4 hover:underline dark:text-brand-violet",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-8 px-3.5 text-xs",
        lg: "h-12 px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
