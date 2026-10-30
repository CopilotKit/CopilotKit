import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "../../lib/utils";
import type { ClassValue } from "../../lib/utils";

// Styles live in styles/css/ui/button.css.
const variantClasses = {
  default: "cpk-button-default",
  destructive: "cpk-button-destructive",
  outline: "cpk-button-outline",
  secondary: "cpk-button-secondary",
  ghost: "cpk-button-ghost",
  link: "cpk-button-link",
  assistantMessageToolbarButton: "cpk-button-assistant-message-toolbar",
  chatInputToolbarPrimary: "cpk-button-chat-input-toolbar-primary",
  chatInputToolbarSecondary: "cpk-button-chat-input-toolbar-secondary",
} as const;

const sizeClasses = {
  default: "cpk-button-size-default",
  sm: "cpk-button-size-sm",
  lg: "cpk-button-size-lg",
  icon: "cpk-button-size-icon",
  chatInputToolbarIcon: "cpk-button-size-chat-input-toolbar-icon",
  chatInputToolbarIconLabel: "cpk-button-size-chat-input-toolbar-icon-label",
} as const;

type ButtonVariant = keyof typeof variantClasses;
type ButtonSize = keyof typeof sizeClasses;

interface ButtonVariantProps {
  /** Defaults to `"default"`. `null` applies no variant class. */
  variant?: ButtonVariant | null;
  /** Defaults to `"default"`. `null` applies no size class. */
  size?: ButtonSize | null;
}

/**
 * Returns the class names for a button with the given variant and size,
 * followed by `className`.
 */
function buttonVariants({
  variant,
  size,
  className,
  class: classProp,
}: ButtonVariantProps & {
  className?: ClassValue;
  class?: ClassValue;
} = {}): string {
  return cn(
    "cpk-button",
    variant !== null && variantClasses[variant ?? "default"],
    size !== null && sizeClasses[size ?? "default"],
    classProp,
    className,
  );
}

const Button = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> &
    ButtonVariantProps & {
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
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  );
});

export { Button, buttonVariants };
