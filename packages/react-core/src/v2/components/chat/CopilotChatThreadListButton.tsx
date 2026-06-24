import React, { MouseEvent } from "react";
import { PanelLeft } from "lucide-react";

import { renderSlot, SlotValue } from "../../lib/slots";
import { cn } from "../../lib/utils";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";

/**
 * Default thread-list (drawer) icon. A side-panel glyph signalling that the
 * button reveals the list of threads alongside the chat.
 */
const DefaultThreadListIcon: React.FC<React.SVGProps<SVGSVGElement>> = ({
  className,
  ...props
}) => (
  <PanelLeft
    className={cn("cpk:h-4 cpk:w-4", className)}
    strokeWidth={1.75}
    {...props}
  />
);

DefaultThreadListIcon.displayName = "CopilotChatThreadListButton.Icon";

export interface CopilotChatThreadListButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  /** Optional slot override for the thread-list icon. */
  icon?: SlotValue<typeof DefaultThreadListIcon>;
}

const BUTTON_BASE_CLASSES = cn(
  "copilotKitButton",
  "cpk:inline-flex cpk:size-8 cpk:items-center cpk:justify-center cpk:rounded-full cpk:text-muted-foreground cpk:transition cpk:cursor-pointer",
  "cpk:hover:bg-muted cpk:hover:text-foreground cpk:focus-visible:outline-none cpk:focus-visible:ring-2 cpk:focus-visible:ring-ring",
  "cpk:disabled:pointer-events-none cpk:disabled:opacity-60",
);

/**
 * Chat-header launcher that opens the thread-list (drawer) panel.
 *
 * Clicking it transitions the shared {@link CopilotChatConfigurationProvider}
 * tri-state to `"threads"`. Because `chat` and `threads` are mutually
 * exclusive, opening the thread list collapses the chat panel — the foundation
 * for the mobile two-panel coordination consumed by the CopilotDrawer wrapper.
 *
 * This component renders the launcher only; it does NOT render any drawer
 * element. The actual drawer surface and the "selecting a thread auto-returns
 * to chat" wiring live in the drawer wrapper that consumes this state.
 */
export const CopilotChatThreadListButton = React.forwardRef<
  HTMLButtonElement,
  CopilotChatThreadListButtonProps
>(function CopilotChatThreadListButton(
  { icon, className, onClick, type, disabled, ...restProps },
  ref,
) {
  const configuration = useCopilotChatConfiguration();

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (disabled) {
      return;
    }

    if (onClick) {
      onClick(event);
    }

    if (event.defaultPrevented) {
      return;
    }

    configuration?.setModalState("threads");
  };

  const renderedIcon = renderSlot(icon, DefaultThreadListIcon, {
    className: "cpk:h-4 cpk:w-4",
    "aria-hidden": true,
    focusable: false,
  });

  return (
    <button
      ref={ref}
      type={type ?? "button"}
      data-copilotkit
      data-testid="copilot-thread-list-button"
      data-slot="chat-thread-list-button"
      data-state={configuration?.modalState === "threads" ? "open" : "closed"}
      className={cn(BUTTON_BASE_CLASSES, className)}
      aria-label="Show threads"
      aria-pressed={configuration?.modalState === "threads"}
      disabled={disabled}
      onClick={handleClick}
      {...restProps}
    >
      {renderedIcon}
    </button>
  );
});

CopilotChatThreadListButton.displayName = "CopilotChatThreadListButton";
export default CopilotChatThreadListButton;

export { DefaultThreadListIcon as CopilotChatThreadListButtonIcon };
