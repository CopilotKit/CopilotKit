import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  );
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-copilotkit
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "cpk:bg-primary cpk:text-primary-foreground cpk:animate-in cpk:fade-in-0 cpk:zoom-in-95 cpk:data-[state=closed]:animate-out cpk:data-[state=closed]:fade-out-0 cpk:data-[state=closed]:zoom-out-95 cpk:data-[side=bottom]:slide-in-from-top-2 cpk:data-[side=left]:slide-in-from-right-2 cpk:data-[side=right]:slide-in-from-left-2 cpk:data-[side=top]:slide-in-from-bottom-2 cpk:z-50 cpk:w-fit cpk:origin-(--radix-tooltip-content-transform-origin) cpk:rounded-md cpk:px-3 cpk:py-1.5 cpk:text-xs cpk:text-balance",
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="cpk:bg-primary cpk:fill-primary cpk:z-50 cpk:size-2.5 cpk:translate-y-[calc(-50%_-_2px)] cpk:rotate-45 cpk:rounded-[2px]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
