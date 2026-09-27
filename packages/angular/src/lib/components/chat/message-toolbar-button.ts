import { cn } from "../../utils";

/**
 * Icon button used in the assistant and user message toolbars, matching
 * React's `assistantMessageToolbarButton` button variant.
 */
export const MESSAGE_TOOLBAR_BUTTON_CLASS = cn(
  // Button base
  "cpk:inline-flex cpk:shrink-0 cpk:items-center cpk:justify-center cpk:gap-2 cpk:outline-none",
  "cpk:focus-visible:ring-[3px] cpk:focus-visible:ring-ring/50",
  "cpk:disabled:pointer-events-none cpk:disabled:opacity-50",
  "cpk:[&_svg]:pointer-events-none cpk:[&_svg]:shrink-0",
  // Toolbar variant
  "cpk:cursor-pointer cpk:p-0 cpk:size-7 cpk:rounded-md",
  "cpk:text-muted-foreground cpk:hover:bg-accent cpk:hover:text-foreground",
  "cpk:transition-colors",
);
