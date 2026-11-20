import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "../../lib/utils";

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

/**
 * Popover content in a portal, so it floats over the page instead of taking
 * room in the layout, with the CopilotKit style scope on it.
 */
const PopoverContent = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "start", sideOffset = 6, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      data-copilotkit
      data-copilotkit-popover
      data-slot="popover-content"
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "cpk:z-50 cpk:outline-none cpk:data-[state=open]:animate-in cpk:data-[state=open]:fade-in-0 cpk:data-[state=open]:zoom-in-95 cpk:data-[side=bottom]:slide-in-from-top-1 cpk:data-[side=top]:slide-in-from-bottom-1",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = "PopoverContent";

export { Popover, PopoverAnchor, PopoverContent };
