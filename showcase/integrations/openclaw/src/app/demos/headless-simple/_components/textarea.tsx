import * as React from "react";
import { cn } from "./cn";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className = "", ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full resize-none border-0 bg-transparent text-sm text-neutral-900",
      "placeholder:text-neutral-400 focus:outline-none focus-visible:ring-0",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
