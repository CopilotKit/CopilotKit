import React, { useState, MouseEvent } from "react";
import { MessageCircle, X } from "lucide-react";

import { renderSlot, SlotValue } from "@/lib/slots";
import { cn } from "@/lib/utils";
import {
  CopilotChatDefaultLabels,
  useCopilotChatConfiguration,
} from "@/providers/CopilotChatConfigurationProvider";

const DefaultOpenIcon: React.FC<React.SVGProps<SVGSVGElement>> = ({
  className,
  ...props
}) => (
  <MessageCircle
    className={cn("cpk:h-6 cpk:w-6", className)}
    strokeWidth={1.75}
    fill="currentColor"
    {...props}
  />
);

const DefaultCloseIcon: React.FC<React.SVGProps<SVGSVGElement>> = ({
  className,
  ...props
}) => (
  <X
    className={cn("cpk:h-6 cpk:w-6", className)}
    strokeWidth={1.75}
    {...props}
  />
);

DefaultOpenIcon.displayName = "CopilotChatToggleButton.OpenIcon";
DefaultCloseIcon.displayName = "CopilotChatToggleButton.CloseIcon";

export interface CopilotChatToggleButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  /** Optional slot override for the chat (closed) icon. */
  openIcon?: SlotValue<typeof DefaultOpenIcon>;
  /** Optional slot override for the close icon. */
  closeIcon?: SlotValue<typeof DefaultCloseIcon>;
}

const ICON_TRANSITION_STYLE: React.CSSProperties = Object.freeze({
  transition:
    "opacity 120ms ease-out, transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
});

const ICON_WRAPPER_BASE =
  "cpk:pointer-events-none cpk:absolute cpk:inset-0 cpk:flex cpk:items-center cpk:justify-center cpk:will-change-transform";

const BUTTON_BASE_CLASSES = cn(
  "cpk:fixed cpk:bottom-6 cpk:right-6 cpk:z-[1100] cpk:flex cpk:h-14 cpk:w-14 cpk:items-center cpk:justify-center",
  "cpk:rounded-full cpk:border cpk:border-primary cpk:bg-primary cpk:text-primary-foreground",
  "cpk:shadow-sm cpk:transition-all cpk:duration-200 cpk:ease-out",
  "cpk:hover:scale-[1.04] cpk:hover:shadow-md",
  "cpk:cursor-pointer",
  "cpk:active:scale-[0.96]",
  "cpk:focus-visible:outline-none cpk:focus-visible:ring-2 cpk:focus-visible:ring-primary/50 cpk:focus-visible:ring-offset-2 cpk:focus-visible:ring-offset-background",
  "cpk:disabled:pointer-events-none cpk:disabled:opacity-60",
);

export const CopilotChatToggleButton = React.forwardRef<
  HTMLButtonElement,
  CopilotChatToggleButtonProps
>(function CopilotChatToggleButton(
  { openIcon, closeIcon, className, ...buttonProps },
  ref,
) {
  const { onClick, type, disabled, ...restProps } = buttonProps;

  const configuration = useCopilotChatConfiguration();
  const labels = configuration?.labels ?? CopilotChatDefaultLabels;

  const [fallbackOpen, setFallbackOpen] = useState(false);

  const isOpen = configuration?.isModalOpen ?? fallbackOpen;
  const setModalOpen = configuration?.setModalOpen ?? setFallbackOpen;

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

    const nextOpen = !isOpen;
    setModalOpen(nextOpen);
  };

  const renderedOpenIcon = renderSlot(openIcon, DefaultOpenIcon, {
    className: "cpk:h-6 cpk:w-6",
    "aria-hidden": true,
    focusable: false,
  });

  const renderedCloseIcon = renderSlot(closeIcon, DefaultCloseIcon, {
    className: "cpk:h-6 cpk:w-6",
    "aria-hidden": true,
    focusable: false,
  });

  const openIconElement = (
    <span
      aria-hidden="true"
      data-slot="chat-toggle-button-open-icon"
      className={ICON_WRAPPER_BASE}
      style={{
        ...ICON_TRANSITION_STYLE,
        opacity: isOpen ? 0 : 1,
        transform: `scale(${isOpen ? 0.75 : 1}) rotate(${isOpen ? 90 : 0}deg)`,
      }}
    >
      {renderedOpenIcon}
    </span>
  );

  const closeIconElement = (
    <span
      aria-hidden="true"
      data-slot="chat-toggle-button-close-icon"
      className={ICON_WRAPPER_BASE}
      style={{
        ...ICON_TRANSITION_STYLE,
        opacity: isOpen ? 1 : 0,
        transform: `scale(${isOpen ? 1 : 0.75}) rotate(${isOpen ? 0 : -90}deg)`,
      }}
    >
      {renderedCloseIcon}
    </span>
  );

  return (
    <button
      ref={ref}
      type={type ?? "button"}
      data-copilotkit
      data-testid="copilot-chat-toggle"
      data-slot="chat-toggle-button"
      data-state={isOpen ? "open" : "closed"}
      className={cn(BUTTON_BASE_CLASSES, className)}
      aria-label={
        isOpen ? labels.chatToggleCloseLabel : labels.chatToggleOpenLabel
      }
      aria-pressed={isOpen}
      disabled={disabled}
      onClick={handleClick}
      {...restProps}
    >
      {openIconElement}
      {closeIconElement}
    </button>
  );
});
CopilotChatToggleButton.displayName = "CopilotChatToggleButton";
export default CopilotChatToggleButton;

export {
  DefaultOpenIcon as CopilotChatToggleButtonOpenIcon,
  DefaultCloseIcon as CopilotChatToggleButtonCloseIcon,
};
