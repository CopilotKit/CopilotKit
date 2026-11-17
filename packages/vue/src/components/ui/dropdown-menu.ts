/** An entry of a `CopilotDropdownMenuContent`: an item, a submenu, or "-". @internal */
export type CopilotDropdownMenuEntry = CopilotDropdownMenuItem | "-";

/** @internal */
export interface CopilotDropdownMenuItem {
  label: string;
  action?: () => void;
  /** Makes the item a submenu trigger. */
  items?: CopilotDropdownMenuEntry[];
  /** Extra classes on the item. */
  class?: string;
}

/** Why a dropdown menu closed by itself. @internal */
export type CopilotDropdownMenuDismissReason = "escape" | "tab" | "outside";
